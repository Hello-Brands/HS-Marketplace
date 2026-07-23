import { parseAsStringLiteral } from "nuqs"

// Browse list/map view, shared by BrowsePage, the header search, and the
// floating toggle so they coordinate through the URL instead of prop drilling
// across the server/client boundary. Default matches the old useState default.
export const VIEW_MODES = ["list", "map"] as const
export type ViewMode = (typeof VIEW_MODES)[number]
export const viewModeParser = parseAsStringLiteral(VIEW_MODES).withDefault("map")
