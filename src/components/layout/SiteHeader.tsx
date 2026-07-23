import { auth } from "@/auth"
import { deriveCapabilities, visibleNavItems, type NavWorld } from "@/lib/navigation"
import { HeaderNav } from "./HeaderNav"
import { MobileTabBar } from "./MobileTabBar"

interface SiteHeaderProps {
  world: NavWorld
  title?: string
  subtitle?: string
  mobileSearch?: React.ReactNode
}

export async function SiteHeader({ world, title, subtitle, mobileSearch }: SiteHeaderProps) {
  const session = await auth()
  const user = session?.user
  if (!user) return null

  const caps = deriveCapabilities({
    role: user.role,
    sellerAccess: user.sellerAccess,
    ownerIdentifier: user.ownerIdentifier,
  })

  return (
    <>
      <HeaderNav
        world={world}
        caps={caps}
        email={user.email ?? ""}
        title={title}
        subtitle={subtitle}
        mobileSearch={mobileSearch}
      />
      {world === "marketplace" && <MobileTabBar items={visibleNavItems(world, caps)} />}
    </>
  )
}
