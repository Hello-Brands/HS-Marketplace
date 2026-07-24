"use client"

import { useEffect } from "react"
import { acquireScrollLock, releaseScrollLock } from "@/lib/scroll-lock"

/** Locks body scroll while `active` is true. Safe to nest across overlays. */
export function useScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return
    acquireScrollLock()
    return () => releaseScrollLock()
  }, [active])
}
