import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { SiteHeader } from '@/components/layout/SiteHeader'

export default async function SellerLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth()

  if (!session?.user) {
    redirect('/login')
  }

  if (!session.user.sellerAccess && session.user.role !== 'admin') {
    redirect('/access-denied')
  }

  return (
    <div className="min-h-screen">
      <SiteHeader world="marketplace" />
      <main className="max-w-5xl mx-auto px-4 lg:px-6 py-8">{children}</main>
    </div>
  )
}
