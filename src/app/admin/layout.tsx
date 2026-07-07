import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { AppShell } from '@/components/layout/AppShell'

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
    <AppShell world="admin" mainClassName="max-w-7xl mx-auto px-4 lg:px-8 py-8">
      {children}
    </AppShell>
  )
}
