'use client'

import { useEffect, useCallback } from 'react'
import type { KpiMetric } from '@/lib/kpi/schema'
import { KpiTrendChart } from './KpiTrendChart'

interface KpiTrendModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  metric: KpiMetric
  formatValue: (value: number) => string
}

export function KpiTrendModal({
  isOpen,
  onClose,
  title,
  metric,
  formatValue,
}: KpiTrendModalProps) {
  // Close on Escape key
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    },
    [onClose]
  )

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown)
      // Prevent body scroll when modal is open
      document.body.style.overflow = 'hidden'
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = ''
    }
  }, [isOpen, handleKeyDown])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Scrim */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal panel */}
      <div
        className="relative bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4 p-8 max-h-[90dvh] overflow-y-auto transition-all duration-150 ease-out"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 h-11 w-11 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors focus-visible:ring-2 focus-visible:ring-hs-red-500 focus-visible:ring-offset-2"
          aria-label="Close modal"
        >
          <svg
            className="w-6 h-6"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>

        {/* Title */}
        <h3
          id="modal-title"
          className="text-xl font-semibold text-gray-900 mb-6"
        >
          {title}{metric.trend.length >= 2 ? ' — 12-Month Trend' : ''}
        </h3>

        {/* Chart */}
        <KpiTrendChart
          data={metric.trend}
          label={title}
          formatValue={formatValue}
          height={240}
        />
      </div>
    </div>
  )
}
