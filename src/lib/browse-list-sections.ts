export interface ListSections {
  listings: boolean
  competitors: boolean
  empty: boolean
  /**
   * Whether the listings block may start collapsed. True ONLY when a
   * competitor block renders alongside it — collapsing the only visible block
   * would open the page to a header and nothing else.
   */
  collapsibleListings: boolean
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
  return {
    listings,
    competitors,
    empty: !listings && !competitors,
    collapsibleListings: listings && competitors,
  }
}
