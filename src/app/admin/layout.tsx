import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import Link from 'next/link'

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth()

  if (!session?.user) {
    redirect('/login')
  }

  if (session.user.role !== 'admin') {
    redirect('/access-denied')
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Navigation */}
      <nav className="sticky top-0 z-40 bg-white/80 backdrop-blur-lg border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Left side */}
            <div className="flex items-center gap-8">
              {/* Logo */}
              <Link href="/admin" className="flex items-center gap-2.5">
                <div className="w-8 h-8 bg-hs-red-600 rounded-lg flex items-center justify-center">
                  <span className="text-white font-bold text-xs">HS</span>
                </div>
                <span className="font-semibold text-gray-900 tracking-tight">
                  Admin
                </span>
              </Link>

              {/* Nav links */}
              <div className="hidden md:flex items-center gap-1">
                <NavLink href="/admin/queue">Queue</NavLink>
                <NavLink href="/admin/listings">Listings</NavLink>
                <NavLink href="/admin/inquiries">Inquiries</NavLink>
                <NavLink href="/admin/users">Users</NavLink>
                <NavLink href="/admin/data">Data</NavLink>
              </div>
            </div>

            {/* Right side */}
            <div className="flex items-center gap-2 sm:gap-3">
              {/* Switch to the marketplace — admins can also buy/sell */}
              <Link
                href="/browse"
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                Browse
              </Link>
              <Link
                href="/seller/listings"
                className="hidden lg:inline-flex px-3 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
              >
                My Listings
              </Link>
              <Link
                href="/seller/listings/new"
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-hs-red-600 text-white rounded-lg text-sm font-semibold shadow-sm transition-all duration-200 hover:bg-hs-red-700 hover:shadow-md active:scale-[0.98]"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                <span className="hidden sm:inline">New Listing</span>
              </Link>

              <span className="hidden lg:block h-6 w-px bg-gray-200" />
              <span className="hidden xl:block text-sm text-gray-500">
                {session.user.email}
              </span>
              <span className="inline-flex items-center px-2.5 py-1 bg-gray-900 text-white text-xs font-semibold rounded-md">
                Admin
              </span>
            </div>
          </div>
        </div>
      </nav>

      {/* Main content */}
      <main className="max-w-7xl mx-auto px-4 lg:px-8 py-8">{children}</main>
    </div>
  )
}

function NavLink({
  href,
  children,
}: {
  href: string
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      className="px-3 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
    >
      {children}
    </Link>
  )
}
