import { useEffect, useState } from 'react'
import { useDataQuery } from '@dhis2/app-runtime'
import { PeriodTypeCategory, PeriodUtility } from '@hisptz/dhis2-utils'
import { snakeCase } from 'lodash-es'
import { DateTime, Interval } from 'luxon'

import {
    getVisualizationDimensions,
    getVisualizationFilters,
} from '@packages/shared/utils'
import {
    AnalyticsData,
    DimensionConfig,
    VisualizationConfig,
    YearOverYearVisualizationConfig,
} from '@packages/shared/schemas'
import { compact, isEmpty } from 'lodash-es'

type AnalyticsParams = Record<string, string[]>

function normalizeAnalyticsParams(params: AnalyticsParams): AnalyticsParams {
    return Object.fromEntries(
        Object.entries(params)
            .map(([key, values]) => [key, compact(values)])
            .filter(([, values]) => values.length > 0)
    )
}

function ensurePeriod(
    filters: AnalyticsParams,
    dimensions: AnalyticsParams,
    fallbackPeriods: string[] = ['THIS_YEAR']
): { filters: AnalyticsParams; dimensions: AnalyticsParams } {
    const normalizedFilters = normalizeAnalyticsParams(filters)
    const normalizedDimensions = normalizeAnalyticsParams(dimensions)
    const hasPeriod =
        !isEmpty(normalizedFilters.pe) || !isEmpty(normalizedDimensions.pe)

    if (hasPeriod) {
        return { filters: normalizedFilters, dimensions: normalizedDimensions }
    }

    return {
        filters: { ...normalizedFilters, pe: fallbackPeriods },
        dimensions: normalizedDimensions,
    }
}

const analyticsQuery = {
    analytics: {
        resource: 'analytics',
        params: ({
            filters,
            dimensions,
            relativePeriodDate,
        }: {
            filters: Record<string, string[]>
            dimensions: Record<string, string[]>
            relativePeriodDate?: string
        }) => {
            return {
                displayProperty: 'NAME',
                filter: Object.keys(filters).map(
                    (key) => `${key}:${filters[key]?.join(';')}`
                ),
                dimension: Object.keys(dimensions).map(
                    (key) => `${key}:${dimensions[key]?.join(';')}`
                ),
                includeMetadataDetails: 'true',
                relativePeriodDate,
            }
        },
    },
}

export function useAnalytics({
    visualizationConfig,
    params,
}: {
    visualizationConfig: VisualizationConfig
    params: Map<string, string>
}) {
    const [selectedOrgUnits, setSelectedOrgUnits] = useState<string[]>([])
    const [selectedPeriods, setSelectedPeriods] = useState<string[]>([])

    const { refetch, loading, data } = useDataQuery<{
        analytics: AnalyticsData
        //@ts-expect-error DHIS2 app runtime issues
    }>(analyticsQuery, {
        lazy: true,
    })
    const [lastError, setLastError] = useState<string>()

    useEffect(() => {
        const baseFilters = getVisualizationFilters(visualizationConfig, {
            searchParams: params,
            selectedOrgUnits,
            selectedPeriods,
        })
        const baseDimensions = getVisualizationDimensions(visualizationConfig, {
            searchParams: params,
            selectedOrgUnits,
            selectedPeriods,
        })
        const { filters, dimensions } = ensurePeriod(
            baseFilters,
            baseDimensions,
            !isEmpty(selectedPeriods)
                ? selectedPeriods
                : params.get('pe')?.split(',') ?? ['THIS_YEAR']
        )

        refetch({
            filters,
            dimensions,
        })
            .then(() => setLastError(undefined))
            .catch((e: unknown) => {
                console.error('Analytics fetch failed', {
                    visualizationName: visualizationConfig.name,
                    visualizationType: visualizationConfig.type,
                    filters,
                    dimensions,
                    error: e,
                })
                setLastError(
                    e instanceof Error ? e.message : 'Unknown fetch error'
                )
            })
    }, [refetch, params, selectedOrgUnits, selectedPeriods])
    return {
        loading,
        analytics: data?.analytics,
        lastError,
        refetch,
        setSelectedPeriods,
        setSelectedOrgUnits,
        selectedPeriods,
        selectedOrgUnits,
    }
}

function normalizeYear(year: string) {
    const periodCategory = PeriodUtility.getPeriodCategoryFromPeriodId(year)
    if (periodCategory === PeriodTypeCategory.FIXED) {
        return [year]
    }
    const period = PeriodUtility.getPeriodById(year)
    const interval = Interval.fromDateTimes(
        period.start,
        DateTime.now().minus({ year: 1 })
    )
    const years = interval.splitBy({ year: 1 })
    if (years.length > 1) {
        return years.map((year) => year.start!.year.toString())
    }

    return [period.start.year.toString()]
}

function normalizeYears(years: string[]) {
    return years.flatMap((year) => normalizeYear(year))
}

export function useYearOverYearAnalytics({
    visualizationConfig,
    params,
}: {
    visualizationConfig: YearOverYearVisualizationConfig
    params: Map<string, string>
}) {
    const [data, setData] = useState<Map<string, AnalyticsData>>()
    const [selectedOrgUnits, setSelectedOrgUnits] = useState<string[]>([])
    const [selectedPeriods, setSelectedPeriods] = useState<string[]>(
        params?.get('pe')?.split(',') ?? []
    )

    const { refetch, loading } = useDataQuery<{
        analytics: AnalyticsData
        //@ts-expect-error DHIS2 app runtime issues
    }>(analyticsQuery, { lazy: true })
    const [lastError, setLastError] = useState<string>()

    //Get the selected relative period
    const selectedRelativePeriods = Object.entries(
        visualizationConfig.relativePeriods || {}
    )
        .filter(([_, value]) => value)
        .map(([key]) => snakeCase(key).toUpperCase())

    const selectedYears = selectedPeriods.filter(
        (periodId: string) =>
            PeriodUtility.getPeriodById(periodId).type.rank === 8 ||
            periodId.includes('YEAR')
    )

    const years =
        selectedYears.length > 0
            ? selectedYears
            : visualizationConfig.yearlySeries || []

    const yearsToFetch = normalizeYears(years)

    const orgUnitFilter = (visualizationConfig.filters || []).find(
        (filter: DimensionConfig) => filter.dimension === 'ou'
    )
    const orgUnits = orgUnitFilter
        ? orgUnitFilter.items.map((item: { id: string }) => item.id)
        : []

    const dataFilter = (visualizationConfig.filters || []).find(
        (filter: DimensionConfig) => filter.dimension === 'dx'
    )
    const dx = dataFilter
        ? dataFilter.items.map((item: { id: string }) => item.id)
        : []

    // Prepare an analytics query per each year to fetch (dynamic)
    useEffect(() => {
        async function fetchYearlyAnalytics() {
            const yearData = new Map<string, AnalyticsData>()
            for (const yearId of yearsToFetch.reverse()) {
                const date = new Date()
                const period = PeriodUtility.getPeriodById(yearId)
                const year = period.start.year

                const periodDate = new Date(date.setFullYear(year))
                const periodDateString = `${periodDate.getFullYear()}-${periodDate.getMonth() + 1}-${periodDate.getDate() + 1}`

                const { filters, dimensions } = ensurePeriod(
                    {
                        ou:
                            selectedOrgUnits.length > 0
                                ? selectedOrgUnits
                                : orgUnits,
                        dx,
                    },
                    {
                        pe:
                            selectedPeriods.length > 0
                                ? selectedPeriods
                                : selectedRelativePeriods,
                    },
                    ['THIS_YEAR']
                )

                const response = (await refetch({
                    filters,
                    relativePeriodDate: periodDateString,
                    dimensions,
                })) as { analytics: AnalyticsData }
                setLastError(undefined)

                yearData.set(yearId, response.analytics)
            }
            setData(yearData)
        }

        fetchYearlyAnalytics().catch((e: unknown) => {
            console.error('Year-over-year analytics fetch failed', {
                visualizationName: visualizationConfig.name,
                visualizationType: visualizationConfig.type,
                selectedPeriods,
                selectedOrgUnits,
                error: e,
            })
            setLastError(
                e instanceof Error ? e.message : 'Unknown fetch error'
            )
        })
    }, [selectedOrgUnits, selectedPeriods, visualizationConfig, years])

    return {
        analytics: data,
        loading,
        lastError,
        setSelectedPeriods,
        setSelectedOrgUnits,
        selectedPeriods,
        selectedOrgUnits,
    }
}
