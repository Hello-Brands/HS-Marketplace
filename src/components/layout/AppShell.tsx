import { SiteHeader } from "@/components/layout/SiteHeader"

/**
 * Shared chrome for the authenticated areas (admin + seller): the site header
 * plus a centered main column. The auth guards stay in each layout because they
 * genuinely differ (admin role vs. seller access), so only the identical wrapper
 * markup is shared here (DEBT-019).
 */
export function AppShell({
  world,
  mainClassName,
  children,
}: {
  world: React.ComponentProps<typeof SiteHeader>["world"]
  mainClassName: string
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen">
      <SiteHeader world={world} />
      <main className={mainClassName}>{children}</main>
    </div>
  )
}
