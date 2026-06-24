"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"

interface FilterPopoverProps {
  label: string
  /** Apply the active (filter-set) styling to the trigger pill. */
  active?: boolean
  /** Short summary shown as a badge when active (e.g. a count or "$500k+"). */
  summary?: string | null
  /** Panel content. Receives a `close` callback to dismiss after applying. */
  children: (close: () => void) => ReactNode
  align?: "left" | "right"
  panelClassName?: string
}

/**
 * A pill-shaped filter trigger that opens a popover panel. Closes on outside
 * click and Escape. Each popover is independent; clicking another pill counts
 * as an outside click, so only one stays open at a time.
 */
export function FilterPopover({
  label,
  active = false,
  summary,
  children,
  align = "left",
  panelClassName = "",
}: FilterPopoverProps) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`
          inline-flex items-center gap-2 h-11 px-4 rounded-full border text-sm font-medium
          transition-all duration-200 ease-out
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hs-red-500 focus-visible:ring-offset-1
          ${
            active
              ? "border-hs-red-300 bg-hs-red-50 text-hs-red-700"
              : "border-gray-300 bg-white text-gray-700 hover:border-gray-400 hover:bg-gray-50"
          }
        `}
      >
        <span>{label}</span>
        {active && summary && (
          <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-hs-red-600 text-white text-xs font-semibold tabular-nums">
            {summary}
          </span>
        )}
        <svg
          className={`h-4 w-4 text-gray-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          role="dialog"
          className={`
            absolute z-30 mt-2 ${align === "right" ? "right-0" : "left-0"}
            rounded-2xl border border-gray-200 bg-white shadow-xl p-3 min-w-[240px]
            origin-top animate-[filterpop_140ms_ease-out]
            ${panelClassName}
          `}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}
