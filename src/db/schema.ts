// Export enums first (required for Drizzle migration ordering)
export * from "./schema/enums"

// Auth tables (from Plan 02)
export * from "./schema/auth"

// Domain tables
export * from "./schema/listings"
export * from "./schema/photos"
export * from "./schema/contacts"
export * from "./schema/alerts"
export * from "./schema/competitorAlertLog"
export * from "./schema/favorites"
export * from "./schema/listingViews"
export * from "./schema/loginEvents"
export * from "./schema/savedCompetitors"

// Owner directory (Part A)
export * from "./schema/ownerLocations"
export * from "./schema/userOwnerLinks"

// Competitor closures — scraper-owned, app read-only (see schema file header)
export * from "./schema/competitorOpportunities"

// Brand-request pipeline (monitor repo co-writes both; see file headers)
export * from "./schema/brandRequests"
export * from "./schema/monitoredBrands"

export * from "./schema/disclaimerAcknowledgments"
