// src/components/ui/Sheet.tsx
"use client"

import { useEffect } from "react"
import { useScrollLock } from "@/hooks/useScrollLock"

// Mobile-only overlay primitives (md:hidden). Hand-rolled — no Radix in this
// repo. Escape / backdrop-tap close; body scroll locks via the shared counted
// lock so nested sheets can't unlock each other. Close is never blocked on
// content — the X and backdrop always work.

interface SheetBaseProps {
  open: boolean
  onClose: () => void
  /** Accessible dialog name, shown in the sheet header. */
  title: string
  children: React.ReactNode
}

function useSheetEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onEsc)
    return () => document.removeEventListener("keydown", onEsc)
  }, [open, onClose])
}

function SheetHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 shrink-0">
      <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
      <button
        onClick={onClose}
        aria-label={`Close ${title.toLowerCase()}`}
        className="flex items-center justify-center w-11 h-11 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hs-red-500"
      >
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}

/** Partial-height sheet sliding up from the bottom (layer toggles, sort). */
export function BottomSheet({ open, onClose, title, children }: SheetBaseProps) {
  useScrollLock(open)
  useSheetEscape(open, onClose)
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 md:hidden">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="absolute inset-x-0 bottom-0 flex max-h-[70dvh] flex-col rounded-t-2xl bg-white shadow-xl animate-[sheetup_0.2s_ease-out]"
      >
        <SheetHeader title={title} onClose={onClose} />
        <div className="overflow-y-auto px-4 py-3 pb-safe-lg">{children}</div>
      </div>
    </div>
  )
}

interface FullScreenSheetProps extends SheetBaseProps {
  /** Sticky footer (e.g. "Show results" + "Clear all"). Sits above the safe area. */
  footer?: React.ReactNode
}

/** Full-viewport sheet sliding up (mobile filters). */
export function FullScreenSheet({ open, onClose, title, children, footer }: FullScreenSheetProps) {
  useScrollLock(open)
  useSheetEscape(open, onClose)
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 md:hidden">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="absolute inset-0 flex flex-col bg-white animate-[sheetup_0.2s_ease-out]"
      >
        <SheetHeader title={title} onClose={onClose} />
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4">{children}</div>
        {footer && (
          <div className="shrink-0 border-t border-gray-200 px-4 pt-3 pb-safe-lg bg-white">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
