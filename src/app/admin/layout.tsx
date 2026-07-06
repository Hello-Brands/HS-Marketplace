import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { SiteHeader } from '@/components/layout/SiteHeader'

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
    <div className="min-h-screen">
      <SiteHeader world="admin" />
      <main className="max-w-7xl mx-auto px-4 lg:px-8 py-8">{children}</main>
    </div>
  )
}
