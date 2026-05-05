import { RefObject, useMemo } from 'react'

import { AnalyticsData, VisualizationConfig } from '../../schemas'
import { isArray, isEmpty } from 'lodash-es'
import { DHIS2PivotTable } from '@hisptz/dhis2-analytics'
import { getVisualizationLegendSet } from '../../utils'
import { LegendSet } from '@hisptz/dhis2-utils'

export interface TableVisualizerProps {
    analytics: AnalyticsData
    visualization: VisualizationConfig
    setRef: RefObject<HTMLTableElement | null>
    fullScreen: boolean
}

export function TableVisualizer({
    analytics,
    visualization,
    setRef,
    fullScreen,
}: TableVisualizerProps) {
    const sanitizedAnalytics = useMemo(() => {
        const headers = analytics?.headers ?? []
        const expectedColumns = headers.length
        const rows = analytics?.rows ?? []
        const headerNames = headers.map((header) => header.name)

        const layoutDimensions = [
            ...(visualization.rows ?? []),
            ...(visualization.columns ?? []),
            ...(visualization.filters ?? []),
        ]

        const keyIndexes = layoutDimensions
            .map((dimension) => headerNames.indexOf(dimension.dimension))
            .filter((index) => index >= 0)

        const fallbackKeyIndexes =
            keyIndexes.length > 0
                ? keyIndexes
                : headerNames
                      .map((name, index) => ({ name, index }))
                      .filter(({ name }) => name !== 'value')
                      .map(({ index }) => index)

        const validRows = rows.filter(
            (row) => Array.isArray(row) && row.length === expectedColumns
        )

        const rowIdentity = (row: string[]) =>
            fallbackKeyIndexes.map((index) => row[index]).join('|')

        const uniqueRows = Array.from(
            new Map(validRows.map((row) => [rowIdentity(row), row])).values()
        )

        if (uniqueRows.length === rows.length) return analytics
        return {
            ...analytics,
            rows: uniqueRows,
        }
    }, [analytics])

    const legend = useMemo(() => {
        if (!visualization.legend) {
            return
        }
        if (visualization.legend.strategy === 'FIXED') {
            if (!visualization.legend.set) {
                return
            }
            return {
                ...visualization.legend,
            }
        }

        if (visualization.legend.strategy === 'BY_DATA_ITEM') {
            const legendSets = getVisualizationLegendSet(visualization)
            if (isArray(legendSets)) {
                const legendMap = new Map<string, LegendSet>(
                    legendSets.map(({ dataItem, legendSet }) => [
                        dataItem,
                        legendSet,
                    ])
                )
                return {
                    ...visualization.legend,
                    legendMap,
                }
            }
        }
    }, [visualization.legend])

    return (
        <DHIS2PivotTable
            /*
	 // @ts-expect-error library fix */
            setRef={setRef}
            tableProps={{
                scrollHeight: fullScreen
                    ? `calc(100dvh - 96px)`
                    : `calc(100% - 48px)`,
            }}
            analytics={sanitizedAnalytics}
            config={{
                options: {
                    fixColumnHeaders: true,
                    fixRowHeaders: true,
                    showFilterAsTitle: !isEmpty(visualization.filters),
                    // @ts-expect-error legend prop not in type definitions but supported at runtime
                    legend: legend,
                },
                layout: {
                    columns: visualization.columns,
                    filter: visualization.filters ?? [],
                    rows: visualization.rows,
                },
            }}
        />
    )
}
