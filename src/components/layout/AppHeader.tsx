import { UserNav } from "@/components/browse/UserNav"

interface AppHeaderProps {
  title: string
  subtitle?: string
  isAdmin?: boolean
  hasSeller?: boolean
  isOwner?: boolean
}

export function AppHeader({ title, subtitle, isAdmin, hasSeller, isOwner }: AppHeaderProps) {
  return (
    <header className="bg-white border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-hs-red-600 rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-sm">HS</span>
          </div>
          <div>
            <h1 className="text-lg font-semibold text-gray-900 tracking-tight">{title}</h1>
            {subtitle && <p className="text-sm text-gray-500">{subtitle}</p>}
          </div>
        </div>
        <UserNav isAdmin={isAdmin} hasSeller={hasSeller} isOwner={isOwner} />
      </div>
    </header>
  )
}
