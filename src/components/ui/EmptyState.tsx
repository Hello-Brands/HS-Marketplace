interface EmptyStateProps {
  icon?: React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
  compact?: boolean
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  compact = false,
}: EmptyStateProps) {
  return (
    <div
      className={`
        flex flex-col items-center justify-center text-center
        ${compact ? 'py-8 px-4' : 'py-16 px-6'}
      `}
    >
      {icon && (
        <div
          className={`
            flex items-center justify-center
            rounded-2xl bg-hs-red-50
            ${compact ? 'w-12 h-12 mb-4' : 'w-16 h-16 mb-6'}
          `}
        >
          <span className={`text-hs-red-600 ${compact ? 'scale-75' : ''}`}>{icon}</span>
        </div>
      )}
      <h3
        className={`font-semibold text-gray-900 ${compact ? 'text-base' : 'text-lg'}`}
      >
        {title}
      </h3>
      {description && (
        <p
          className={`
            text-gray-500 max-w-sm
            ${compact ? 'text-sm mt-1' : 'text-base mt-2'}
          `}
        >
          {description}
        </p>
      )}
      {action && <div className={compact ? 'mt-4' : 'mt-6'}>{action}</div>}
    </div>
  )
}

// Illustration-based empty state for major sections
export function EmptyStateIllustrated({
  title,
  description,
  action,
}: {
  title: string
  description: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
      {/* Brand drop mark */}
      <img
        src="/hs-logo-drop.png"
        alt=""
        aria-hidden="true"
        className="h-16 w-auto opacity-90 mb-8"
      />

      <h2 className="text-xl font-semibold text-gray-900 mb-2">{title}</h2>
      <p className="text-gray-500 max-w-md mb-6">{description}</p>
      {action}
    </div>
  )
}
