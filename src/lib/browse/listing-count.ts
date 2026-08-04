// Single source of truth for the "listings" count format shared by
// ListingGrid's own header and the collapsed-panel badge in
// BrowseListContent. Both must render the identical count string — this
// module is what keeps them from drifting when one is edited and the other
// isn't. Pure: import nothing.

export const LISTINGS_PAGE_SIZE = 12

export function formatListingCount(count: number, hasMore: boolean): string {
  return `${count}${hasMore ? "+" : ""}`
}
