import { forwardRef } from 'react'

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  error?: string
  hint?: string
  inputSize?: 'sm' | 'md' | 'lg'
}

const sizeStyles = {
  sm: 'px-3 py-1.5 text-base sm:text-sm min-h-[80px]',
  md: 'px-3.5 py-2.5 text-base sm:text-sm min-h-[100px]',
  lg: 'px-4 py-3 text-base min-h-[120px]',
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, error, hint, inputSize = 'md', id, className = '', ...props }, ref) => {
    const textareaId = id || props.name

    return (
      <div className="space-y-1.5">
        {label && (
          <label
            htmlFor={textareaId}
            className="block text-sm font-medium text-gray-900"
          >
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={textareaId}
          className={`
            block w-full rounded-lg border
            text-gray-900 placeholder:text-gray-400
            resize-y
            transition-all duration-150
            focus:outline-none focus:ring-2 focus:ring-hs-red-500/20 focus:border-hs-red-500
            disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-not-allowed disabled:resize-none
            ${sizeStyles[inputSize]}
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
            error ? `${textareaId}-error` : hint ? `${textareaId}-hint` : undefined
          }
          {...props}
        />
        {hint && !error && (
          <p id={`${textareaId}-hint`} className="text-sm text-gray-500">
            {hint}
          </p>
        )}
        {error && (
          <p
            id={`${textareaId}-error`}
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

Textarea.displayName = 'Textarea'
