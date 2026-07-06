'use client'

import { useState } from 'react'

const REJECTION_REASONS = [
  'Wrong category',
  'Missing information',
  'Ownership verification failed',
  'Incomplete photos',
  'Pricing issue',
  'Duplicate listing',
  'Other',
]

interface RejectionModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: (reason: string, notes: string) => void
  listingTitle: string
  isProcessing?: boolean
}

export function RejectionModal({
  isOpen,
  onClose,
  onConfirm,
  listingTitle,
  isProcessing,
}: RejectionModalProps) {
  const [reason, setReason] = useState('')
  const [notes, setNotes] = useState('')

  if (!isOpen) return null

  const handleConfirm = () => {
    if (!reason) return
    onConfirm(reason, notes)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-md w-full p-6 max-h-[90dvh] overflow-y-auto">
        <h3 className="text-lg font-bold text-gray-900 mb-2">Reject Listing</h3>
        <p className="text-gray-500 text-sm mb-4">
          Rejecting: <span className="font-medium">{listingTitle}</span>
        </p>

        <div className="space-y-4">
          <div>
            <label htmlFor="rejectionReason" className="block text-sm font-medium text-gray-700 mb-1">
              Reason <span className="text-hs-red-500">*</span>
            </label>
            <select
              id="rejectionReason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-hs-red-500"
            >
              <option value="">Select a reason...</option>
              {REJECTION_REASONS.map(r => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="rejectionNotes" className="block text-sm font-medium text-gray-700 mb-1">
              Additional notes (optional)
            </label>
            <textarea
              id="rejectionNotes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Any additional details for the seller..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-hs-red-500"
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={onClose}
            disabled={isProcessing}
            className="px-4 py-2 border border-gray-300 rounded-lg font-medium hover:bg-gray-50 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-hs-red-500 focus-visible:ring-offset-2"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!reason || isProcessing}
            className="px-4 py-2 bg-hs-red-600 text-white rounded-lg font-medium hover:bg-hs-red-700 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-hs-red-500 focus-visible:ring-offset-2"
          >
            {isProcessing ? 'Rejecting...' : 'Reject Listing'}
          </button>
        </div>
      </div>
    </div>
  )
}
