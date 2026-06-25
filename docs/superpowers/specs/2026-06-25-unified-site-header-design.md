# Unified Site Header — Design Spec

**Date:** 2026-06-25
**Status:** Approved for planning

## Problem

Navigation across the marketplace is inconsistent and, in places, a dead end:

| Area | Header today | Escape hatch |
|------|-------------|--------------|
| `/browse`, `/account/alerts` | Full `AppHeader` + `UserNav` | Yes |
| `/account/favorites`, `/account/locations` | None — breadcrumb only | "Back to Browse" only |
| `/listings/[id]` | None — breadcrumb only | Breadcrumb only |
| `/seller/*` | Minimal bar (logo + My Listings + Create) | **Dead end** — no link to Browse/Alerts/Admin |
| `/admin/*` | Rich admin nav + one-way "Browse" link | One-way to Browse |
| `/` (landing) | Marketing nav + Sign In | n/a (pre-auth) |

There is no consistent way to move between the Marketplace and Admin worlds, several authenticated pages have no header at all, and the brand mark is a placeholder "HS" red square rather than the Hello Sugar logo.

## Goals

1. One consistent header shell across all authenticated app pages.
2. Keep the Marketplace and Admin worlds visually distinct, but always one click apart (admins only).
3. Replace the "HS" red-square placeholder with the real Hello Sugar logo.
4. No regressions to existing capability gating (admin-only, seller-only, owner-only links).

## Non-goals

- Redesigning the public landing page (`/`) beyond optionally swapping its logo mark.
- Changing auth, routing, or page content other than the header and now-redundant breadcrumbs.
- Adding new destinations that don't already exist.

## Chosen design: two-tier header ("Layout C")

A single shared header with two rows:

**Top tier (global, identical within a world):**
- Hello Sugar logo (links to the world's home: `/browse` for Marketplace, `/admin` for Admin).
- Spacer.
- **World switcher** — a `Marketplace / Admin` segmented control. **Rendered only for admins.** Light/neutral styling in the Marketplace world; dark with a red active segment in the Admin world, so the current world is unmistakable.
- **Account menu** — avatar button opening a dropdown: user email, role badge, "My Locations" (owners only), Sign out.

**Bottom tier (contextual to the current world + page):**
- Page title + subtitle/count on the left (e.g. "Browse Listings · 12 active listings", "Approval Queue · 4 pending").
- Section links on the right, scoped to the current world (active link highlighted by current path).
- Primary action button when relevant (Marketplace: "+ Add Listing", seller-gated).

### The two worlds

| World | Home | Section links | Primary action |
|-------|------|---------------|----------------|
| Marketplace | `/browse` | Browse, Saved, My Alerts, My Listings* | + Add Listing* |
| Admin | `/admin` | Queue, Listings, Inquiries, Users, Data, Owners | — |

\* `My Listings` and `+ Add Listing` render only when `hasSeller`. `My Locations` (owners only) lives in the account dropdown, not the section row.

### Capability gating (unchanged semantics)

Derived from the session, centralized in the header (today this logic is copy-pasted at each call site):
- `isAdmin = session.user.role === "admin"`
- `hasSeller = !!session.user.sellerAccess || isAdmin`
- `isOwner = !!session.user.ownerIdentifier`

Rules:
- Non-admins never see the world switcher and can never reach the Admin world via the header.
- Non-sellers don't see "My Listings" or "+ Add Listing".
- Non-owners don't see "My Locations".

### Mobile

Top tier collapses to **logo + hamburger**; the page title remains visible on the bottom tier. The hamburger opens the existing slide-in drawer (already built in `UserNav`), now organized into labeled groups:
- **Marketplace** — Browse, Saved, My Alerts, My Listings*, + Add Listing*
- **Admin** — "Switch to Admin…" (admins only; in the Admin world this group shows the admin links instead)
- **Account** — email, My Locations (owners), Sign out

## Architecture

A single source of truth for nav structure plus small, focused components.

### `src/lib/navigation.ts` (new)
Pure, testable config + helpers — no React.
- `type NavWorld = "marketplace" | "admin"`
- `interface NavItem { label; href; icon?; requires?: "seller" | "owner" | "admin" }`
- `MARKETPLACE_NAV: NavItem[]`, `ADMIN_NAV: NavItem[]`
- `interface Capabilities { isAdmin; hasSeller; isOwner }`
- `deriveCapabilities(user): Capabilities` — the single definition of the gating rules above.
- `visibleNavItems(world, caps): NavItem[]` — filters by `requires`.
- `isActive(currentPath, href): boolean` — active-link logic (exact match for world homes, prefix match for sub-sections).

Defining the link lists once means desktop and mobile (and tests) consume the same data.

### `src/components/layout/SiteHeader.tsx` (server component — evolves the current `AppHeader`)
Props: `{ world: NavWorld; title: string; subtitle?: string }`.
Responsibilities:
- Calls `auth()`, computes `Capabilities` via `deriveCapabilities`.
- Renders the two-tier shell, the logo, and the title/subtitle.
- Passes `world`, `caps`, and resolved nav items down to the client nav.

Because it resolves the session itself, call sites shrink to `<SiteHeader world="marketplace" title="Saved Listings" subtitle={...} />` — no capability prop-drilling.

### `src/components/layout/HeaderNav.tsx` (client — evolves the current `UserNav`)
- Reads `usePathname()` for active-link highlighting.
- Renders the desktop section links + primary action, the hamburger, and the mobile drawer with grouped links.
- Receives nav items + caps + world as props (no session access on the client).

### `src/components/layout/WorldSwitcher.tsx` (client)
- The `Marketplace / Admin` segmented control. Rendered only when `isAdmin`.
- Styling differs by current world (neutral vs dark/red active).

### `src/components/layout/AccountMenu.tsx` (client)
- Avatar button + dropdown (email, role badge, My Locations if owner, Sign out via `signOut`).

### Logo
- Source the official Hello Sugar logo from the brand kit (the `hello-sugar-brand` skill) during implementation; place it under `public/` (prefer SVG). Render via `next/image` or inline SVG at the header size.
- Logo links to the current world's home.

## Where the header is applied

| Route(s) | World | How |
|----------|-------|-----|
| `/browse` | marketplace | already renders header (in `BrowsePage`) — swap to `SiteHeader` |
| `/account/alerts` | marketplace | already renders header — swap to `SiteHeader` |
| `/account/favorites`, `/account/locations` | marketplace | add `SiteHeader` (replaces bare breadcrumb) |
| `/listings/[id]` | marketplace | add `SiteHeader` |
| `/seller/*` | marketplace | replace the custom nav in `src/app/seller/layout.tsx` with `SiteHeader` |
| `/admin/*` | admin | replace the custom nav in `src/app/admin/layout.tsx` with `SiteHeader` |

Per-page titles/counts are passed by each page (the header can't know a page's live count). For `/seller/*` and `/admin/*`, the section layout renders `SiteHeader` with a static title; sub-pages that want a more specific title can override by rendering their own `SiteHeader` instead (decided per page during implementation).

**Untouched:** `/` (landing), `/login`, `/access-denied`, `/action-complete` keep their current bare/marketing chrome. Optionally swap the landing/login "HS" square for the new logo for brand consistency (low priority).

## Cleanup

- Remove now-redundant `Breadcrumb` usage from `/account/favorites`, `/account/locations`, and `/listings/[id]` where the header's title + section nav already convey location. Keep a breadcrumb only if it adds hierarchy the header doesn't.
- The top tier deliberately drops the standalone Saved/Alerts quick-icons that appeared in an early mockup — those are covered by the bottom-tier section links, so there's no duplication.

## Testing

Unit (vitest):
- `deriveCapabilities` — admin / seller / owner / plain-buyer permutations.
- `visibleNavItems` — non-admin gets no admin items; non-seller gets no seller items; owner-gated items respect `isOwner`.
- `isActive` — world-home exact match vs sub-section prefix match (e.g. `/admin/listings/123` highlights "Listings").

Component/render:
- `SiteHeader` renders the switcher only for admins.
- Marketplace vs Admin world shows the correct section links and primary action.
- Non-seller marketplace view omits "My Listings" / "+ Add Listing".

## Error handling

The header is presentational and assumes an authenticated session; all target pages already `redirect("/login")` before rendering when unauthenticated. No new error states.
