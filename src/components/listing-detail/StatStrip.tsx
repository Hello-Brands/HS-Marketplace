import { daysListed } from '@/lib/analytics/helpers'

interface StatStripProps {
  listedAt: Date | null
  createdAt: Date
  viewCount: number
  savesCount: number
}

function Cell({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <div className="flex-1 px-2 py-3.5 text-center border-r border-gray-100 last:border-r-0">
      <div className="flex items-center justify-center gap-1.5 text-2xl font-bold text-gray-900 leading-none">
        <span className="text-hs-red-600">{icon}</span>
        {value}
      </div>
      <div className="mt-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
        {label}
      </div>
    </div>
  )
}

export function StatStrip({ listedAt, createdAt, viewCount, savesCount }: StatStripProps) {
  const days = daysListed(listedAt ?? createdAt, new Date())
  const iconCls = 'h-4 w-4'
  return (
    <div className="mt-5 flex items-stretch rounded-xl border border-gray-200 overflow-hidden">
      <Cell
        icon={
          <svg className={iconCls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <path strokeLinecap="round" d="M16 2v4M8 2v4M3 10h18" />
          </svg>
        }
        value={days === 0 ? 'New' : String(days)}
        label="Days listed"
      />
      <Cell
        icon={
          <svg className={iconCls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        }
        value={String(viewCount)}
        label="Views"
      />
      <Cell
        icon={
          <svg className={iconCls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 14c1.5-1.5 3-3.3 3-5.5A3.5 3.5 0 0 0 12 6 3.5 3.5 0 0 0 2 8.5c0 2.2 1.5 4 3 5.5l7 7z" />
          </svg>
        }
        value={String(savesCount)}
        label="Saves"
      />
    </div>
  )
}
