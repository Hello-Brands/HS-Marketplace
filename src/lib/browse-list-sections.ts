export interface ListSections {
  listings: boolean
  competitors: boolean
  empty: boolean
}

/**
 * Which blocks the browse list should render, derived from the Hello Sugar /
 * Competitors layer toggles. The competitor block also requires competitor data
 * to exist. `empty` is true when neither block will render.
 */
export function listSections(
  showListings: boolean,
  showCompetitors: boolean,
  hasCompetitors: boolean
): ListSections {
  const listings = showListings
  const competitors = showCompetitors && hasCompetitors
  return { listings, competitors, empty: !listings && !competitors }
}
