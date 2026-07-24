import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { AppShell } from '@/components/layout/AppShell'

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
    <AppShell world="marketplace" mainClassName="max-w-5xl mx-auto px-4 lg:px-6 py-8 pb-tabbar">
      {children}
    </AppShell>
  )
}
