import { auth } from "@/auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import { getInquiries } from "./actions"

export default async function AdminInquiriesPage() {
  const session = await auth()

  if (!session?.user || session.user.role !== "admin") {
    redirect("/")
  }

  const inquiries = await getInquiries()

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold text-gray-900">Buyer Inquiries</h1>

      {inquiries.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-gray-500">
          No inquiries yet.
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Date
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Listing
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Buyer
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Seller
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Message
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {inquiries.map((inquiry) => {
                  const listingDisplay =
                    inquiry.listingTitle ??
                    inquiry.listingLocationName ??
                    (inquiry.listingCity && inquiry.listingState
                      ? `${inquiry.listingCity}, ${inquiry.listingState}`
                      : `Listing ${inquiry.listingId.slice(0, 8)}`)

                  return (
                    <tr key={inquiry.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {new Date(inquiry.createdAt).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                          timeZone: "America/Denver",
                        })}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <Link
                          href={`/listings/${inquiry.listingId}`}
                          className="text-hs-red-600 hover:text-hs-red-700 hover:underline"
                        >
                          {listingDisplay}
                        </Link>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <div className="font-medium text-gray-900">{inquiry.buyerName ?? "—"}</div>
                        <div className="text-gray-500">{inquiry.buyerEmail ?? "—"}</div>
                        {inquiry.buyerPhone && (
                          <div className="text-gray-500">{inquiry.buyerPhone}</div>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <div className="font-medium text-gray-900">{inquiry.sellerName ?? "—"}</div>
                        <div className="text-gray-500">{inquiry.sellerEmail ?? "—"}</div>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500 max-w-xs">
                        <p className="truncate">{inquiry.message ?? "—"}</p>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
