'use client'

import { useState, useMemo, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ConfirmDialog } from './ConfirmDialog'
import {
  setUserRole,
  setSellerAccess,
  removeUser,
  addToAllowlist,
  removeFromAllowlist,
} from '@/app/admin/users/actions'

interface User {
  id: string
  name: string | null
  email: string | null
  role: string
  sellerAccess: boolean
  createdAt: Date
}

interface AllowlistEntry {
  id: string
  /**
   * Either an individual email address ("someone@partnerbrand.com") or a
   * whole-domain entry, which is stored with a leading "@"
   * ("@partnerbrand.com") and matches that exact domain only.
   */
  email: string
  addedAt: Date
}

interface UsersManagerProps {
  users: User[]
  allowlist: AllowlistEntry[]
  currentUserId: string
}

type ConfirmAction =
  | { type: 'toggleRole'; userId: string; userName: string; currentRole: string }
  | { type: 'toggleSeller'; userId: string; userName: string; currentAccess: boolean }
  | { type: 'removeUser'; userId: string; userName: string }
  | { type: 'removeAllowlist'; email: string }

export function UsersManager({
  users,
  allowlist,
  currentUserId,
}: UsersManagerProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [search, setSearch] = useState('')
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null)
  const [allowlistInput, setAllowlistInput] = useState('')

  const filteredUsers = useMemo(() => {
    if (!search.trim()) return users
    const q = search.toLowerCase()
    return users.filter((user) => {
      const name = (user.name ?? '').toLowerCase()
      const email = (user.email ?? '').toLowerCase()
      return name.includes(q) || email.includes(q)
    })
  }, [users, search])

  const handleConfirm = () => {
    if (!confirmAction) return

    startTransition(async () => {
      try {
        switch (confirmAction.type) {
          case 'toggleRole':
            await setUserRole(
              confirmAction.userId,
              confirmAction.currentRole === 'admin' ? 'user' : 'admin'
            )
            break
          case 'toggleSeller':
            await setSellerAccess(
              confirmAction.userId,
              !confirmAction.currentAccess
            )
            break
          case 'removeUser':
            await removeUser(confirmAction.userId)
            break
          case 'removeAllowlist':
            await removeFromAllowlist(confirmAction.email)
            break
        }
        router.refresh()
      } catch (error) {
        alert((error as Error).message)
      } finally {
        setConfirmAction(null)
      }
    })
  }

  const handleAddAllowlist = (e: React.FormEvent) => {
    e.preventDefault()
    if (!allowlistInput.trim()) return

    startTransition(async () => {
      try {
        const result = await addToAllowlist(allowlistInput.trim())
        if (result.ok) {
          setAllowlistInput('')
          router.refresh()
        } else {
          alert(result.error)
        }
      } catch (error) {
        alert((error as Error).message)
      }
    })
  }

  const getConfirmDialogProps = (): {
    title: string
    message: string
    confirmLabel: string
    variant: 'danger' | 'warning' | 'default'
  } => {
    if (!confirmAction) {
      return { title: '', message: '', confirmLabel: '', variant: 'default' }
    }

    switch (confirmAction.type) {
      case 'toggleRole': {
        const newRole =
          confirmAction.currentRole === 'admin' ? 'user' : 'admin'
        return {
          title: `Change Role to ${newRole}`,
          message: `Are you sure you want to change ${confirmAction.userName}'s role to "${newRole}"?`,
          confirmLabel: `Set as ${newRole}`,
          variant: newRole === 'admin' ? 'warning' : 'default',
        }
      }
      case 'toggleSeller': {
        const action = confirmAction.currentAccess ? 'revoke' : 'grant'
        return {
          title: `${action === 'grant' ? 'Grant' : 'Revoke'} Seller Access`,
          message: `Are you sure you want to ${action} seller access for ${confirmAction.userName}?`,
          confirmLabel: action === 'grant' ? 'Grant Access' : 'Revoke Access',
          variant: action === 'revoke' ? 'warning' : 'default',
        }
      }
      case 'removeUser':
        return {
          title: 'Remove User',
          message: `Are you sure you want to remove ${confirmAction.userName}? This action cannot be undone.`,
          confirmLabel: 'Remove User',
          variant: 'danger',
        }
      case 'removeAllowlist':
        return {
          title: 'Remove from Allowlist',
          message: confirmAction.email.startsWith('@')
            ? `Remove ${confirmAction.email}? Everyone at this domain will lose access on their next sign-in.`
            : `Are you sure you want to remove ${confirmAction.email} from the allowlist?`,
          confirmLabel: 'Remove',
          variant: 'danger',
        }
    }
  }

  const dialogProps = getConfirmDialogProps()

  return (
    <div className="space-y-8">
      <h1 className="font-display text-3xl font-bold text-gray-900">
        User Management
      </h1>

      {/* Users Table */}
      <section className="rounded-xl border border-gray-200 bg-white">
        <div className="border-b border-gray-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">
            Registered Users
          </h2>
        </div>

        {/* Search */}
        <div className="border-b border-gray-100 px-6 py-3">
          <input
            type="text"
            placeholder="Search by name or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-base sm:text-sm text-gray-900 placeholder:text-gray-400 focus:border-hs-red-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-hs-red-500"
          />
          {search.trim() && (
            <p className="mt-1.5 text-xs text-gray-500">
              {filteredUsers.length} of {users.length} user
              {users.length !== 1 ? 's' : ''} match
            </p>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase text-gray-500">
                  User
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase text-gray-500">
                  Role
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase text-gray-500">
                  Seller Access
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase text-gray-500">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {filteredUsers.map((user) => (
                <tr key={user.id} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap px-6 py-4">
                    <p className="text-sm font-medium text-gray-900">
                      {user.name || 'Unnamed'}
                    </p>
                    <p className="text-sm text-gray-500">{user.email}</p>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4">
                    <button
                      type="button"
                      onClick={() =>
                        setConfirmAction({
                          type: 'toggleRole',
                          userId: user.id,
                          userName: user.name || user.email || 'this user',
                          currentRole: user.role,
                        })
                      }
                      disabled={isPending}
                      className={`rounded-lg px-2.5 py-1 text-xs font-medium focus-visible:ring-2 focus-visible:ring-hs-red-500 focus-visible:ring-offset-2 ${
                        user.role === 'admin'
                          ? 'bg-purple-100 text-purple-800'
                          : 'bg-gray-100 text-gray-800'
                      }`}
                    >
                      {user.role}
                    </button>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4">
                    <button
                      type="button"
                      onClick={() =>
                        setConfirmAction({
                          type: 'toggleSeller',
                          userId: user.id,
                          userName: user.name || user.email || 'this user',
                          currentAccess: user.sellerAccess,
                        })
                      }
                      disabled={isPending}
                      className={`rounded-lg px-2.5 py-1 text-xs font-medium focus-visible:ring-2 focus-visible:ring-hs-red-500 focus-visible:ring-offset-2 ${
                        user.sellerAccess
                          ? 'bg-green-100 text-green-800'
                          : 'bg-gray-100 text-gray-800'
                      }`}
                    >
                      {user.sellerAccess ? 'Yes' : 'No'}
                    </button>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4">
                    {user.id !== currentUserId && (
                      <button
                        type="button"
                        onClick={() =>
                          setConfirmAction({
                            type: 'removeUser',
                            userId: user.id,
                            userName: user.name || user.email || 'this user',
                          })
                        }
                        disabled={isPending}
                        className="text-sm text-hs-red-600 hover:text-hs-red-800 focus-visible:ring-2 focus-visible:ring-hs-red-500 focus-visible:ring-offset-2"
                      >
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {filteredUsers.length === 0 && (
                <tr>
                  <td
                    colSpan={4}
                    className="px-6 py-8 text-center text-sm text-gray-500"
                  >
                    {search.trim()
                      ? 'No users match your search.'
                      : 'No users found.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Allowlist Section */}
      <section className="rounded-xl border border-gray-200 bg-white">
        <div className="border-b border-gray-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">
            Allowlist (Non-Franchisees)
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            Add individual email addresses, or approve a whole company with an
            @domain entry (for example @partnerbrand.com). Domain entries match
            that exact domain only.
          </p>
        </div>

        <div className="p-6">
          <form onSubmit={handleAddAllowlist} className="mb-4 flex gap-2">
            <input
              type="text"
              inputMode="email"
              autoComplete="off"
              spellCheck={false}
              placeholder="email@example.com or @partnerbrand.com"
              value={allowlistInput}
              onChange={(e) => setAllowlistInput(e.target.value)}
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-hs-red-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-hs-red-500"
              required
            />
            <button
              type="submit"
              disabled={isPending}
              className="rounded-lg bg-hs-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-hs-red-700 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-hs-red-500 focus-visible:ring-offset-2"
            >
              Add to Allowlist
            </button>
          </form>

          {allowlist.length > 0 ? (
            <ul className="divide-y divide-gray-200">
              {allowlist.map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-center justify-between py-3"
                >
                  <span className="text-sm text-gray-900">
                    {entry.email.startsWith('@') && (
                      <span className="mr-2 inline-flex items-center rounded-full bg-hs-red-50 px-2 py-0.5 text-xs font-medium text-hs-red-700">
                        Domain
                      </span>
                    )}
                    {entry.email}
                    {entry.email.startsWith('@') && (
                      <span className="ml-2 text-xs text-gray-500">
                        everyone at this domain
                      </span>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setConfirmAction({
                        type: 'removeAllowlist',
                        email: entry.email,
                      })
                    }
                    disabled={isPending}
                    className="text-sm text-hs-red-600 hover:text-hs-red-800 focus-visible:ring-2 focus-visible:ring-hs-red-500 focus-visible:ring-offset-2"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-gray-500">No entries in allowlist</p>
          )}
        </div>
      </section>

      <ConfirmDialog
        isOpen={!!confirmAction}
        title={dialogProps.title}
        message={dialogProps.message}
        confirmLabel={dialogProps.confirmLabel}
        variant={dialogProps.variant}
        onConfirm={handleConfirm}
        onCancel={() => setConfirmAction(null)}
        isProcessing={isPending}
      />
    </div>
  )
}
