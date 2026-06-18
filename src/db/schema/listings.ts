import {
  pgTable,
  text,
  timestamp,
  integer,
  boolean,
  real,
  doublePrecision,
  index,
} from "drizzle-orm/pg-core"
import { relations } from "drizzle-orm"
import { listingStatusEnum, listingTypeEnum } from "./enums"
import { users } from "./auth"

export const listings = pgTable("listings", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  sellerId: text("seller_id").notNull().references(() => users.id, { onDelete: "cascade" }),

  // Type and status
  type: listingTypeEnum("type").notNull(),
  status: listingStatusEnum("status").default("draft").notNull(),

  // Display title (generated from locations)
  title: text("title"),

  // Financials (stored in cents for precision)
  askingPrice: integer("asking_price").notNull(),
  ttmProfit: integer("ttm_profit"),

  // Seller content
  reasonForSelling: text("reason_for_selling"), // max 500 chars enforced at app level
  notes: text("notes"), // max 2000 chars enforced at app level

  // Assets included
  inventoryIncluded: boolean("inventory_included").default(false).notNull(),
  laserIncluded: boolean("laser_included").default(false).notNull(),
  otherAssets: text("other_assets"),

  // Admin fields
  rejectionReason: text("rejection_reason"),
  lastReminderSent: timestamp("last_reminder_sent"),

  // Analytics
  viewCount: integer("view_count").default(0).notNull(),
  inquiryCount: integer("inquiry_count").default(0).notNull(),

  // Timestamps
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
})

export const listingLocations = pgTable("listing_locations", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  listingId: text("listing_id").notNull().references(() => listings.id, { onDelete: "cascade" }),

  // Type of location
  locationType: text("location_type", { enum: ["salon", "territory"] }).notNull(),

  // For salon locations (from internal API mock)
  externalId: text("external_id"),
  name: text("name").notNull(),
  address: text("address"),
  city: text("city"),
  state: text("state"), // 2-letter code
  zipCode: text("zip_code"),
  squareFootage: integer("square_footage"),
  openingDate: timestamp("opening_date"),

  // Auto-populated from API mock
  ttmRevenue: integer("ttm_revenue"), // cents
  mcr: real("mcr"), // monthly conversion rate

  // For territory locations
  territoryLat: real("territory_lat"),
  territoryLng: real("territory_lng"),
  territoryRadius: integer("territory_radius"), // meters

  // Geocoded coordinates for salon locations (radius search).
  // Territory locations use territoryLat/Lng above instead.
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  geocodedAt: timestamp("geocoded_at"),
  geocodeSource: text("geocode_source"), // e.g. "internal_api", "maptiler"

  // BigQuery join key. Stores the matched LOCATION_NAME. Real KPI/financials are
  // fetched ONLY when dataMappingStatus === "confirmed". Suggested by name match,
  // human-confirmed in the admin Data Mappings screen.
  bqLocationName: text("bq_location_name"),
  dataMappingStatus: text("data_mapping_status", {
    enum: ["unconfirmed", "confirmed", "not_connected"],
  }).default("unconfirmed").notNull(),

  // Display ordering
  displayOrder: integer("display_order").default(0).notNull(),
}, (table) => [
  // Supports the bounding-box prefilter used by radius search
  index("listing_locations_lat_lng_idx").on(table.latitude, table.longitude),
])

export const listingPhotos = pgTable("listing_photos", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  listingId: text("listing_id").notNull().references(() => listings.id, { onDelete: "cascade" }),

  // Vercel Blob URL
  url: text("url").notNull(),
  filename: text("filename").notNull(),

  // first = 0 = cover photo
  displayOrder: integer("display_order").notNull(),

  createdAt: timestamp("created_at").defaultNow().notNull(),
})

// Relations
export const listingsRelations = relations(listings, ({ one, many }) => ({
  seller: one(users, {
    fields: [listings.sellerId],
    references: [users.id],
  }),
  locations: many(listingLocations),
  photos: many(listingPhotos),
}))

export const listingLocationsRelations = relations(listingLocations, ({ one }) => ({
  listing: one(listings, {
    fields: [listingLocations.listingId],
    references: [listings.id],
  }),
}))

export const listingPhotosRelations = relations(listingPhotos, ({ one }) => ({
  listing: one(listings, {
    fields: [listingPhotos.listingId],
    references: [listings.id],
  }),
}))

// Type exports
export type Listing = typeof listings.$inferSelect
export type NewListing = typeof listings.$inferInsert
export type ListingLocation = typeof listingLocations.$inferSelect
export type NewListingLocation = typeof listingLocations.$inferInsert
export type ListingPhoto = typeof listingPhotos.$inferSelect
export type NewListingPhoto = typeof listingPhotos.$inferInsert
