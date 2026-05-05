import { NextRequest, NextResponse } from 'next/server'
import { dhis2HttpClient } from '@/utils/api/dhis2'
import { FetchError } from '@dhis2/data-engine'
import { notFound } from 'next/navigation'

const whitelistedResources =
    /analytics|legendSets|organisationUnits|geoFeatures|tokens\/google/

export async function GET(request: NextRequest) {
    const url = request.url as string

    let urlToForward = url
        .substring(url.lastIndexOf('/api/'))
        .replace('/api/', '')

    if (!whitelistedResources.test(urlToForward)) {
        return notFound()
    }

    if (urlToForward.startsWith('analytics')) {
        const [pathname, rawQuery = ''] = urlToForward.split('?')
        const searchParams = new URLSearchParams(rawQuery)

        const hasStartDate = !!searchParams.get('startDate')
        const hasEndDate = !!searchParams.get('endDate')
        const dimensions = searchParams.getAll('dimension')
        const filters = searchParams.getAll('filter')

        const hasValidPeInDimension = dimensions.some((dimension) =>
            /^pe:[^;]+/.test(dimension)
        )
        const hasValidPeInFilter = filters.some((filter) =>
            /^pe:[^;]+/.test(filter)
        )

        if (
            !hasStartDate &&
            !hasEndDate &&
            !hasValidPeInDimension &&
            !hasValidPeInFilter
        ) {
            searchParams.append('filter', 'pe:THIS_YEAR')
        }

        urlToForward = `${pathname}?${searchParams.toString()}`
    }

    const retryAnalyticsWithNormalizedPeriod = async (queryPath: string) => {
        if (!queryPath.startsWith('analytics?')) return null
        const [pathname, rawQuery = ''] = queryPath.split('?')
        const searchParams = new URLSearchParams(rawQuery)
        const filters = searchParams.getAll('filter')
        const dimensions = searchParams.getAll('dimension')

        const peFilters = filters.filter((filter) => filter.startsWith('pe:'))
        const hasPeDimension = dimensions.some((d) => d.startsWith('pe:'))
        if (peFilters.length === 0 || hasPeDimension) return null

        searchParams.delete('filter')
        filters
            .filter((filter) => !filter.startsWith('pe:'))
            .forEach((filter) => searchParams.append('filter', filter))
        peFilters.forEach((pe) => searchParams.append('dimension', pe))

        return dhis2HttpClient.get(`${pathname}?${searchParams.toString()}`)
    }

    const retryAnalyticsWithDateRange = async (queryPath: string) => {
        if (!queryPath.startsWith('analytics?')) return null
        const [pathname, rawQuery = ''] = queryPath.split('?')
        const searchParams = new URLSearchParams(rawQuery)
        if (searchParams.get('startDate') && searchParams.get('endDate')) {
            return null
        }

        const currentYear = new Date().getUTCFullYear()
        searchParams.set('startDate', `${currentYear}-01-01`)
        searchParams.set('endDate', `${currentYear}-12-31`)
        return dhis2HttpClient.get(`${pathname}?${searchParams.toString()}`)
    }

    const retryAnalyticsWithNormalizedDimensions = async (queryPath: string) => {
        if (!queryPath.startsWith('analytics?')) return null
        const [pathname, rawQuery = ''] = queryPath.split('?')
        const searchParams = new URLSearchParams(rawQuery)

        const filters = searchParams.getAll('filter')
        const dimensions = searchParams.getAll('dimension')

        const dxFilters = filters.filter((filter) => filter.startsWith('dx:'))
        const hasDxDimension = dimensions.some((dimension) =>
            dimension.startsWith('dx:')
        )

        const rebuiltFilters: string[] = []
        for (const filter of filters) {
            if (filter.startsWith('dx:')) continue
            if (filter.startsWith('ou:')) {
                const values = filter.replace('ou:', '').split(';')
                const explicitOrgUnits = values.filter(
                    (value) => !value.startsWith('LEVEL-')
                )
                const levelTokens = values.filter((value) =>
                    value.startsWith('LEVEL-')
                )
                const normalizedOu =
                    explicitOrgUnits.length > 0
                        ? explicitOrgUnits
                        : levelTokens
                rebuiltFilters.push(`ou:${normalizedOu.join(';')}`)
                continue
            }
            rebuiltFilters.push(filter)
        }

        searchParams.delete('filter')
        rebuiltFilters.forEach((filter) => searchParams.append('filter', filter))

        if (!hasDxDimension && dxFilters.length > 0) {
            dxFilters.forEach((dx) => searchParams.append('dimension', dx))
        }

        return dhis2HttpClient.get(`${pathname}?${searchParams.toString()}`)
    }

    try {
        const response = await dhis2HttpClient.get(urlToForward)
        return NextResponse.json(response)
    } catch (error) {
        if (error instanceof FetchError) {
            if (
                error.details?.errorCode === 'E7104' &&
                urlToForward.startsWith('analytics')
            ) {
                try {
                    const retried =
                        await retryAnalyticsWithNormalizedPeriod(urlToForward)
                    if (retried) return NextResponse.json(retried)
                } catch {
                    // continue to date-range fallback
                }

                try {
                    const dateRangeRetried =
                        await retryAnalyticsWithDateRange(urlToForward)
                    if (dateRangeRetried)
                        return NextResponse.json(dateRangeRetried)
                } catch {
                    // continue to dimension normalization fallback
                }

                try {
                    const normalizedDimensionsRetried =
                        await retryAnalyticsWithNormalizedDimensions(
                            urlToForward
                        )
                    if (normalizedDimensionsRetried)
                        return NextResponse.json(normalizedDimensionsRetried)
                } catch {
                    // return original error below
                }
            }
            const status = error.details?.httpStatusCode ?? 500
            return NextResponse.json(
                {
                    status: 'ERROR',
                    message: error.message,
                    errorCode: error.details?.errorCode,
                    details: error.details,
                },
                { status }
            )
        }

        return NextResponse.json(
            {
                status: 'ERROR',
                message: 'Unexpected error while forwarding DHIS2 request',
            },
            { status: 500 }
        )
    }
}
