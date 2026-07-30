import type { BrandRequestStatus } from '@/db/schema/brandRequests'

/**
 * Status chip for brand requests — mirrors listings/StatusBadge.tsx.
 *
 * Two label sets over one status column. Admins see the raw pipeline stage so
 * they can tell recon from build; franchisees see collapsed, outcome-oriented
 * copy — both recon stages read "Under review" because the distinction is an
 * implementation detail of the monitor repo, not something they act on.
 */

type StatusStyle = { bgClass: string; textClass: string; dotClass: string }

const STATUS_STYLES: Record<BrandRequestStatus, StatusStyle> = {
  submitted: {
    bgClass: 'bg-gray-100',
    textClass: 'text-gray-700',
    dotClass: 'bg-gray-500',
  },
  recon_running: {
    bgClass: 'bg-amber-100',
    textClass: 'text-amber-800',
    dotClass: 'bg-amber-500',
  },
  recon_complete: {
    bgClass: 'bg-sky-100',
    textClass: 'text-sky-800',
    dotClass: 'bg-sky-500',
  },
  approved: {
    bgClass: 'bg-emerald-100',
    textClass: 'text-emerald-800',
    dotClass: 'bg-emerald-500',
  },
  rejected: {
    bgClass: 'bg-hs-red-100',
    textClass: 'text-hs-red-800',
    dotClass: 'bg-hs-red-500',
  },
  building: {
    bgClass: 'bg-amber-100',
    textClass: 'text-amber-800',
    dotClass: 'bg-amber-500',
  },
  live: {
    bgClass: 'bg-emerald-100',
    textClass: 'text-emerald-800',
    dotClass: 'bg-emerald-500',
  },
  needs_human: {
    bgClass: 'bg-amber-100',
    textClass: 'text-amber-800',
    dotClass: 'bg-amber-500',
  },
}

const ADMIN_LABELS: Record<BrandRequestStatus, string> = {
  submitted: 'Submitted',
  recon_running: 'Recon running',
  recon_complete: 'Recon complete',
  approved: 'Approved',
  rejected: 'Rejected',
  building: 'Building',
  live: 'Live',
  needs_human: 'Needs human',
}

const USER_LABELS: Record<BrandRequestStatus, string> = {
  submitted: 'Submitted',
  recon_running: 'Under review',
  recon_complete: 'Under review',
  approved: 'Approved',
  rejected: 'Rejected',
  building: 'Setting up',
  live: 'Live',
  needs_human: 'In progress — needs manual setup',
}

interface RequestStatusBadgeProps {
  status: BrandRequestStatus
  audience?: 'user' | 'admin'
  size?: 'sm' | 'md'
  showDot?: boolean
}

export function RequestStatusBadge({
  status,
  audience = 'user',
  size = 'sm',
  showDot = true,
}: RequestStatusBadgeProps) {
  const style = STATUS_STYLES[status]
  const label = (audience === 'admin' ? ADMIN_LABELS : USER_LABELS)[status]
  const sizeClasses = size === 'sm' ? 'text-xs px-2 py-0.5' : 'text-sm px-3 py-1'
  const dotSize = size === 'sm' ? 'h-1.5 w-1.5' : 'h-2 w-2'

  return (
    <span
      className={`
        inline-flex items-center gap-1.5
        rounded-full font-semibold
        ${style.bgClass} ${style.textClass}
        ${sizeClasses}
      `
        .trim()
        .replace(/\s+/g, ' ')}
    >
      {showDot && (
        <span className={`rounded-full flex-shrink-0 ${style.dotClass} ${dotSize}`} />
      )}
      {label}
    </span>
  )
}
