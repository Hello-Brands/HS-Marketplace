import { forwardRef } from 'react'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline'
type ButtonSize = 'sm' | 'md' | 'lg' | 'xl'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  icon?: React.ReactNode
  iconPosition?: 'left' | 'right'
  fullWidth?: boolean
  children: React.ReactNode
}

const variantStyles: Record<ButtonVariant, string> = {
  primary: `
    bg-hs-red-600 text-white
    hover:bg-hs-red-700
    active:bg-hs-red-800
    disabled:bg-gray-300 disabled:text-gray-500
    shadow-sm hover:shadow-md
  `,
  secondary: `
    bg-white text-gray-900
    border border-gray-300
    hover:bg-gray-50
    active:bg-gray-100
    disabled:border-gray-200 disabled:text-gray-400 disabled:hover:bg-white
  `,
  outline: `
    bg-hs-red-100 text-hs-red-700
    hover:bg-hs-red-200
    active:bg-hs-red-200
    disabled:bg-gray-100 disabled:text-gray-400 disabled:hover:bg-gray-100
  `,
  ghost: `
    bg-transparent text-gray-700
    hover:bg-hs-red-50 hover:text-gray-900
    active:bg-hs-red-100
    disabled:text-gray-400 disabled:hover:bg-transparent
  `,
  danger: `
    bg-hs-red-600 text-white
    hover:bg-hs-red-700
    active:bg-hs-red-800
    disabled:bg-gray-300 disabled:text-gray-500
  `,
}

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'min-h-9 px-3.5 py-1.5 text-sm gap-1.5',
  md: 'min-h-11 px-4 py-2 text-sm gap-2',
  lg: 'min-h-12 px-5 py-2.5 text-base gap-2',
  xl: 'min-h-14 px-6 py-3 text-base gap-2.5',
}

const iconSizeStyles: Record<ButtonSize, string> = {
  sm: 'h-3.5 w-3.5',
  md: 'h-4 w-4',
  lg: 'h-4 w-4',
  xl: 'h-5 w-5',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      loading,
      icon,
      iconPosition = 'left',
      fullWidth,
      disabled,
      className = '',
      children,
      ...props
    },
    ref
  ) => {
    const iconElement = icon && (
      <span className={`flex-shrink-0 ${iconSizeStyles[size]}`}>{icon}</span>
    )

    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={`
          inline-flex items-center justify-center
          font-semibold rounded-full
          transition-all duration-200 ease-out
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hs-red-500 focus-visible:ring-offset-2
          disabled:cursor-not-allowed
          active:scale-[0.98]
          ${variantStyles[variant]}
          ${sizeStyles[size]}
          ${fullWidth ? 'w-full' : ''}
          ${className}
        `
          .trim()
          .replace(/\s+/g, ' ')}
        {...props}
      >
        {loading && (
          <svg
            className={`animate-spin ${iconSizeStyles[size]}`}
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        )}
        {!loading && iconPosition === 'left' && iconElement}
        <span>{children}</span>
        {!loading && iconPosition === 'right' && iconElement}
      </button>
    )
  }
)

Button.displayName = 'Button'

// Link-styled button for text actions
export function ButtonLink({
  className = '',
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`
        inline-flex items-center gap-1.5
        text-sm font-semibold text-hs-red-600
        hover:text-hs-red-700 hover:underline underline-offset-2
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hs-red-500 focus-visible:ring-offset-2
        disabled:text-gray-400 disabled:no-underline disabled:cursor-not-allowed
        transition-colors duration-150
        ${className}
      `
        .trim()
        .replace(/\s+/g, ' ')}
      {...props}
    >
      {children}
    </button>
  )
}
