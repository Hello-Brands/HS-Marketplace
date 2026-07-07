import { forwardRef } from 'react'

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  hint?: string
  leadingIcon?: React.ReactNode
  trailingIcon?: React.ReactNode
  inputSize?: 'sm' | 'md' | 'lg'
}

const sizeStyles = {
  sm: 'px-3 py-1.5 text-base sm:text-sm',
  md: 'px-3.5 py-2.5 text-base sm:text-sm',
  lg: 'px-4 py-3 text-base',
}

const iconPaddingStyles = {
  sm: { leading: 'pl-9', trailing: 'pr-9' },
  md: { leading: 'pl-10', trailing: 'pr-10' },
  lg: { leading: 'pl-11', trailing: 'pr-11' },
}

const iconSizeStyles = {
  sm: 'h-4 w-4',
  md: 'h-5 w-5',
  lg: 'h-5 w-5',
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      label,
      error,
      hint,
      leadingIcon,
      trailingIcon,
      inputSize = 'md',
      id,
      className = '',
      ...props
    },
    ref
  ) => {
    const inputId = id || props.name

    return (
      <div className="space-y-1.5">
        {label && (
          <label
            htmlFor={inputId}
            className="block text-sm font-medium text-gray-900"
          >
            {label}
          </label>
        )}
        <div className="relative">
          {leadingIcon && (
            <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
              <span className={`text-gray-400 ${iconSizeStyles[inputSize]}`}>
                {leadingIcon}
              </span>
            </div>
          )}
          <input
            ref={ref}
            id={inputId}
            className={`
              block w-full rounded-lg border
              text-gray-900 placeholder:text-gray-400
              transition-all duration-150
              focus:outline-none focus:ring-2 focus:ring-hs-red-600/20 focus:border-hs-red-600
              disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-not-allowed
              ${sizeStyles[inputSize]}
              ${leadingIcon ? iconPaddingStyles[inputSize].leading : ''}
              ${trailingIcon ? iconPaddingStyles[inputSize].trailing : ''}
              ${
                error
                  ? 'border-red-500 focus:ring-red-500/20 focus:border-red-500'
                  : 'border-gray-300 hover:border-gray-400'
              }
              ${className}
            `
              .trim()
              .replace(/\s+/g, ' ')}
            aria-invalid={error ? 'true' : undefined}
            aria-describedby={
              error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined
            }
            {...props}
          />
          {trailingIcon && (
            <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
              <span className={`text-gray-400 ${iconSizeStyles[inputSize]}`}>
                {trailingIcon}
              </span>
            </div>
          )}
        </div>
        {hint && !error && (
          <p id={`${inputId}-hint`} className="text-sm text-gray-500">
            {hint}
          </p>
        )}
        {error && (
          <p
            id={`${inputId}-error`}
            className="text-sm text-hs-red-600 flex items-center gap-1"
            role="alert"
          >
            <svg className="h-4 w-4 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z"
                clipRule="evenodd"
              />
            </svg>
            {error}
          </p>
        )}
      </div>
    )
  }
)

Input.displayName = 'Input'

// Search input variant
export const SearchInput = forwardRef<
  HTMLInputElement,
  Omit<InputProps, 'leadingIcon'>
>(({ className = '', inputSize = 'md', ...props }, ref) => {
  return (
    <Input
      ref={ref}
      type="search"
      inputSize={inputSize}
      leadingIcon={
        <svg className="h-full w-full" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
      }
      className={className}
      {...props}
    />
  )
})

SearchInput.displayName = 'SearchInput'
