import { auth } from "@/auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import { SiteHeader } from "@/components/layout/SiteHeader"
import { BrandRequestForm } from "@/components/brand-requests/BrandRequestForm"

export const metadata = {
  title: "Request a Brand - Hello Sugar Marketplace",
}

export default async function NewBrandRequestPage() {
  const session = await auth()
  if (!session?.user?.id) {
    redirect("/login")
  }

  return (
    <>
      <SiteHeader
        world="marketplace"
        title="Request a Brand"
        subtitle="Ask us to start tracking a competitor"
      />
      <main className="max-w-xl mx-auto px-4 py-6 sm:py-8 pb-tabbar">
        <Link
          href="/account/brand-requests"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-hs-red-600 hover:text-hs-red-700 hover:underline underline-offset-2 transition-colors"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back to my requests
        </Link>

        <div className="mt-5 mb-6">
          <h2 className="text-xl font-semibold text-gray-900">Request a brand</h2>
          <p className="text-sm text-gray-500 mt-1">
            Tell us which competitor to watch. We&apos;ll research their footprint and
            review the request before adding them to tracking.
          </p>
        </div>

        <BrandRequestForm />
      </main>
    </>
  )
}
