import type { listings, listingLocations, listingPhotos } from "@/db/schema/listings"
import type { ListingFormData } from "./types"

export type ListingWithRelations = typeof listings.$inferSelect & {
  locations: (typeof listingLocations.$inferSelect)[]
  photos: (typeof listingPhotos.$inferSelect)[]
}

/**
 * Map a persisted listing (with its locations + photos) to the wizard's form
 * shape. Shared by the seller and admin edit pages, which had byte-identical
 * copies (DEBT-013). Cents columns are converted back to dollars for the form.
 * Uses `?? undefined` (not `|| undefined`) so legitimate 0 values survive the
 * DB->form transform (e.g. squareFootage: 0, ttmRevenue: 0).
 */
export function toListingFormData(listing: ListingWithRelations): ListingFormData {
  return {
    type: listing.type,
    locations: listing.locations.map((loc) => ({
      id: loc.id,
      type: loc.locationType as "salon" | "territory",
      externalId: loc.externalId ?? undefined,
      name: loc.name,
      address: loc.address ?? undefined,
      city: loc.city ?? undefined,
      state: loc.state ?? undefined,
      zipCode: loc.zipCode ?? undefined,
      squareFootage: loc.squareFootage ?? undefined,
      openingDate: loc.openingDate ?? undefined,
      ttmRevenue: loc.ttmRevenue ?? undefined,
      mcr: loc.mcr ?? undefined,
      territoryLat: loc.territoryLat ?? undefined,
      territoryLng: loc.territoryLng ?? undefined,
      territoryRadius: loc.territoryRadius ?? undefined,
    })),
    askingPrice: listing.askingPrice / 100,
    ttmProfit: listing.ttmProfit ? listing.ttmProfit / 100 : undefined,
    reasonForSelling: listing.reasonForSelling ?? undefined,
    photos: listing.photos.map((p) => ({
      id: p.id,
      url: p.url,
      filename: p.filename,
      order: p.displayOrder,
    })),
    inventoryIncluded: listing.inventoryIncluded,
    laserIncluded: listing.laserIncluded,
    inventoryCostEstimate:
      listing.inventoryCostEstimate != null ? listing.inventoryCostEstimate / 100 : undefined,
    otherAssets: listing.otherAssets ?? undefined,
    notes: listing.notes ?? undefined,
  }
}
