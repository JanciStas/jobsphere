'use client'

import { useTranslations } from 'next-intl'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface ConversionFunnelProps {
  total: number
  screening: number
  interview: number
  hired: number
}

export function ConversionFunnel({ total, screening, interview, hired }: ConversionFunnelProps) {
  const t = useTranslations('miscAnalytics')
  const stages = [
    { stage: t('stageApplied'), count: total, percentage: 100 },
    {
      stage: t('stageScreening'),
      count: screening,
      percentage: total > 0 ? (screening / total) * 100 : 0,
    },
    {
      stage: t('stageInterview'),
      count: interview,
      percentage: total > 0 ? (interview / total) * 100 : 0,
    },
    { stage: t('stageHired'), count: hired, percentage: total > 0 ? (hired / total) * 100 : 0 },
  ]

  const getColor = (index: number) => {
    const colors = ['bg-blue-500', 'bg-yellow-500', 'bg-purple-500', 'bg-green-500']
    return colors[index] || 'bg-gray-500'
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('conversionFunnel')}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {stages.map((stage, index) => (
            <div key={index} className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">{stage.stage}</span>
                <span className="text-muted-foreground">
                  {stage.count} ({stage.percentage.toFixed(1)}%)
                </span>
              </div>
              <div className="relative h-8 w-full overflow-hidden rounded-full bg-gray-200">
                <div
                  className={`h-full ${getColor(index)} flex items-center justify-center rounded-full text-sm font-medium text-white transition-all`}
                  style={{
                    width: `${stage.percentage}%`,
                    minWidth: stage.count > 0 ? '40px' : '0',
                  }}
                >
                  {stage.count > 0 && stage.count}
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
