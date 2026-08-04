# Browse Mobile Polish, Map Layering, and New-Closure Recency

**Date:** 2026-08-04
**Status:** Approved by Parker (design reviewed 2026-08-04)
**Requested by:** Parker, with Austin signing off on removing the mobile header logo
**Branch:** `feature/browse-mobile-polish-and-closure-recency` (cut from `origin/main` @ `07395ec`)

## Purpose

Six independent cosmetic/UX fixes to the `/browse` page, driven by a mobile
screenshot review. Five are pure presentation; one (new-closure recency) adds a
small derived-data helper. No schema changes, no server-action changes, no new
queries.

1. Mobile top bar — hamburger overlaps the search field.
2. Mobile bottom tab bar — "Brand Requests" wraps to two lines, growing the bar
   until it covers the map's floating controls.
3. "Hello Sugar listings" list section — collapse by default behind a count
   badge so owners land on competitor closures.
4. Map layering — competitor closures currently render *under* Hello Sugar
   markers; they must render on top.
5. Marker icons — for-sale and owned markers are swapped relative to intent.
6. New-closure recency — highlight closures detected within the last 14 days on
   both the map and the list.

## Explicitly out of scope

**Close date / last-seen date on closure cards.** Originally requested, then
withdrawn during design after a data check (below). Parker is adding a real
per-row `last_seen` to the scraper contract separately; the card treatment will
be designed against that column when it exists.

## Background (what already exists)

- `src/components/browse/BrowsePage.tsx` is the client shell: `?view=list|map`
  via nuqs, a desktop filter bar, a mobile pill row, and either a full-width list
  or a 1/3 list + 2/3 map split. `<main>` carries `pb-tabbar`.
- `src/components/browse/BrowseListContent.tsx` renders up to two blocks —
  "Hello Sugar listings" (`ListingGrid`) and "Competitors" (`CompetitorList`).
  `listSections()` in `src/lib/browse-list-sections.ts` decides which render; a
  local `both` flag decides whether headings appear at all.
- `src/components/browse/MapView.tsx` draws **four** DOM-marker layers via
  MapTiler `Marker({ element })`:
  - listings (for-sale), icon `color`, or `owner` when owned
  - competitor closures, rotated diamonds (caramel filled = opportunity, hollow
    taupe = plain closure)
  - unlisted Hello Sugar locations, icon `white`, or `owner` when owned
  - the search-center teardrop pin + radius circle (GeoJSON layers, not markers)
- **MapTiler rewrites each marker's OUTER element `transform` every frame.** The
  established pattern is: outer element positioned by MapTiler and never touched,
  an `inner` child carrying all visuals plus the hover scale. `z-index` on the
  outer element *is* safe — MapTiler does not set it. This constraint is load-
  bearing for change 6.
- Marker assets in `public/markers/`:
  - `hs-marker-color.png` — red swirl glyph, square aspect, 16px
  - `hs-marker-white.png` — white swirl glyph, square aspect, 16px
  - `hs-marker-owner.png` — "Hello Sugar" wordmark, white on a red rounded field,
    wide aspect, rendered at 24px wide with `height: auto`
- `src/components/browse/MapLegend.tsx` exports `MapLayerRows` (shared by the
  desktop legend panel and the mobile `MobileMapLayers` bottom sheet) with
  `IconSwatch` / `BadgeSwatch` / `Diamond` / `DiamondHollow` swatches mirroring
  the map.
- `src/lib/navigation.ts` holds `MARKETPLACE_NAV` (full labels, used by the
  desktop nav *and* the mobile drawer) and `src/components/layout/MobileTabBar.tsx`
  holds `TAB_LABELS`, a **mobile-tab-bar-only** short-label override map already
  used for `/account/alerts` → "Alerts" and `/seller/listings` → "Listings".
- `.pb-tabbar` in `src/app/globals.css` reserves
  `calc(3.5rem + env(safe-area-inset-bottom))` below `48rem`. `FloatingViewToggle`
  (`absolute bottom-4 … z-20`) and `MobileMapLayers`' FAB (`absolute bottom-4
  right-3 z-10`) rely on that reservation being accurate.
- `src/lib/competitor-query.ts` maps the scraper-owned, strictly read-only
  `competitor_opportunities` table into `CompetitorClosure`, which already
  carries `closedAt: string | null`.

## Data check (performed 2026-08-04 against production)

Queried live: **79 rows total.**

| Fact | Value | Consequence |
|---|---|---|
| Rows with `closed_at` | 57 / 79 | 22 rows can never flag as "new" |
| Rows with `synced_at` | 79 / 79 | but see below |
| `min_synced` / `max_synced` | both `2026-08-02T10:02` | **identical on every row** |
| `closed_at` range | `2026-03-17` → `2026-08-02` | genuine per-row spread |
| Closed within 14 days | **1** | the NEW treatment is near-invisible today |

`synced_at` is uniform because the scraper full-reconciles every row on each run,
so it records the last *reconcile*, not a per-row last-seen. This is what killed
the close-date/last-seen card feature.

**Accepted consequences of shipping change 6 against `closed_at`:**

- `closed_at` means *when the monitor first detected the closure*, not when the
  business actually closed. The UI must say "Detected", never "Closed on".
- The 22 null-`closed_at` rows are never flagged new. Correct-by-omission: we
  cannot claim recency we don't know.
- The scraper runs weekly/monthly, so newly-detected closures arrive in batches.
  The NEW badge will appear in clumps after a scrape rather than trickling in.
- Exactly 1 row qualifies right now. The feature is correct but visually quiet
  until the next scrape. This is the data, not a defect.

---

## Change 1: Mobile top bar

**Problem.** `HeaderNav`'s top tier is `flex items-center justify-between h-14
gap-3` holding `<Logo>` (`h-8 w-auto`, an intrinsically wide horizontal wordmark),
the mobile search slot (`flex-1 min-w-0 md:hidden`), and a 44px hamburger. The
wordmark's intrinsic width plus the search field's minimum leaves the hamburger
visually colliding with the search input.

**Fix.** Hide the logo below `md` *only when a `mobileSearch` slot is present* —
i.e. mirror the existing `mobileSearch ? "hidden md:block" : ""` conditional the
bottom tier already uses. Pages without a mobile search slot (account, seller,
admin) keep their mobile logo, so this stays a `/browse`-shaped fix rather than a
global de-branding. Desktop is untouched at every breakpoint.

Then guarantee the hamburger's tap target: keep the row `gap-3` and confirm the
search wrapper cannot bleed under the button.

**Files:** `src/components/layout/HeaderNav.tsx`. `Logo.tsx` needs no change —
the visibility decision belongs to the layout that knows about the search slot.

**Rejected:** replacing the wordmark with the small swirl mark (costs width for
an affordance the Browse tab already provides); removing the logo at all
breakpoints (Austin okayed removing it to make room on mobile, not de-branding
the desktop masthead).

## Change 2: Mobile bottom tab bar

**Problem.** `MARKETPLACE_NAV` labels "Brand Requests". `MobileTabBar` renders
each label in a `flex-1` column with no wrap control, so at five tabs on a 390px
screen it wraps to two lines. Two effects, both reported:

1. The wrapped label reads as left-shifted rather than centered.
2. The bar grows past the `3.5rem` that `.pb-tabbar` reserves. Because the bar is
   `fixed … bottom-0`, the extra height grows *upward* over the content,
   covering `FloatingViewToggle` and the layers FAB — which is why the buttons in
   the screenshot are clipped.

**Fix.** Two parts, and both are needed — the label alone fixes today's overflow,
the hardening stops the next label from reintroducing it:

1. Add `"/account/brand-requests": "Brands"` to `TAB_LABELS`. This map is
   mobile-tab-bar-only, so the desktop nav and the mobile hamburger drawer keep
   the unambiguous "Brand Requests".
2. Make the tab structurally unable to grow the bar: `whitespace-nowrap` +
   `text-center` on the label span, and `min-w-0` so a long label truncates
   inside its column instead of forcing the row taller.

**Files:** `src/components/layout/MobileTabBar.tsx`.

**Rejected:** growing `.pb-tabbar` to accommodate a two-line bar — spends scarce
vertical space on a small screen and leaves the bar height coupled to label text.

## Change 3: Collapsible "Hello Sugar listings" section

**Goal.** Owners open `/browse` to work competitor closures. The Hello Sugar
listings block should start collapsed behind a count badge, on both mobile and
desktop, expandable on tap.

**Rule (approved).** Collapse applies **only when both sections render** —
reusing the existing `both` flag. If competitors are toggled off, or there is no
closure data at all, listings render expanded exactly as today. Without this
rule, a user with the competitor layer off would open the page to nothing but a
collapsed header.

**Behaviour.**

- Collapsed by default on every page load. Deliberately *not* persisted to the
  URL or `localStorage` — it's a reading preference, not shareable state, and
  adding a nuqs flag would put it in every shared `/browse` link.
- The heading becomes a `<button>` with `aria-expanded` and `aria-controls`,
  keeping the existing `HEADING` typography, plus a count badge and a chevron
  that rotates on expand. Same badge idiom as the mobile Filters pill's
  `activeFilterCount`.
- Count is `initialListings.length`.
- The "Competitors" section is untouched and always expanded.

**Files:** `src/components/browse/BrowseListContent.tsx`. The collapse decision
(`collapsible = both`) is derived where `both` already lives, so
`browse-list-sections.ts` needs no change.

## Change 4: Map layer ordering

**Problem.** No marker layer sets a base `z-index`, so stacking falls out of DOM
insertion order and competitor closures — the thing owners came for — end up
under Hello Sugar markers. Hover handlers set ad-hoc values (`10` for listings,
`5`/`6` for competitors) that don't compose into any order.

**Fix.** Explicit bands on the OUTER marker element (safe — MapTiler doesn't set
`z-index`), with hover lifting a marker within its own band rather than across
bands:

| Layer | base | hovered |
|---|---|---|
| Competitor closures | 40 | 45 |
| For-sale listings (not owned) | 30 | 35 |
| Locations you own | 20 | 25 |
| Unlisted Hello Sugar (not owned) | 10 | — |

Ten-wide bands leave room for a future layer without renumbering.

**Complication.** "Locations you own" is not a fifth marker layer — ownership
cuts across two existing effects (`ownedListingIds` inside the listing effect,
`ownedHsLocationIds` inside the HS-location effect). So the z-index must be
driven by the same `isMine` computation that already picks the icon, not by which
effect built the marker. Both effects already gate `isMine` on `showMyLocations`;
when that legend toggle is off, an owned marker keeps its layer's normal band, so
the ordering degrades consistently with the icon.

The two hover effects keyed on `hoveredId` currently reset `el.style.zIndex = ""`
on non-hovered markers, which would wipe the base band. They must reset to the
marker's base value instead. Storing the base in the tracked marker record
(alongside `marker`/`id`) is cleaner than re-deriving ownership inside the hover
effect.

Unlisted HS markers have no `hoveredId` coordination (they aren't in the list),
so they need no hovered band — their local `mouseenter` scale is enough.

**Files:** `src/components/browse/MapView.tsx`.

## Change 5: Marker icon swap

For-sale and owned markers are currently the opposite of intent.

| Layer | Current | New |
|---|---|---|
| For sale (not owned) | red swirl `hs-marker-color.png` | **wordmark badge** `hs-marker-owner.png` |
| Owned (listing or unlisted salon) | wordmark badge `hs-marker-owner.png` | **red swirl** `hs-marker-color.png` |
| Unlisted Hello Sugar (not owned) | white swirl `hs-marker-white.png` | unchanged |

No asset changes — only which variant each case selects, and the per-variant
sizing/shadow rules follow the asset (the wide wordmark keeps `width: 24px;
height: auto; border-radius: 3px`; the square swirls keep `16px` + `object-fit:
contain`).

**Naming.** The `MARKER_ICON` keys `color` / `owner` describe the artwork, and
after the swap `owner` would mean "for sale" — actively misleading. Rename the
`MarkerVariant` keys to intent-based names (`forSale` / `owned` / `unlisted`)
and let each map to its asset. `MARKER_SHADOW` follows.

**Known, accepted:** an owned for-sale listing and an owned unlisted salon both
render as the red swirl, so ownership outranks for-sale status visually. That's
already true today (both render the wordmark badge), so it is not a regression.
Their popups still differ, which is where the distinction lives.

**Legend.** `MapLayerRows` swatches must swap to match, or the key lies:
"For sale" takes `BadgeSwatch`, "Your locations" takes `IconSwatch`. Note the
existing `titleOverride` copy on the "Your locations" row still reads correctly.

**Files:** `src/components/browse/MapView.tsx`, `src/components/browse/MapLegend.tsx`.

## Change 6: New-closure recency highlight

**Definition.** A closure is "new" when `closedAt` is non-null and within
`NEW_CLOSURE_WINDOW_DAYS = 14` of now. Null `closedAt` is never new.

**New module `src/lib/closure-recency.ts`** — the window constant plus a pure
`isNewClosure(closedAt: string | null, now: Date): boolean`. `now` is injected
rather than read inside, so the boundary is unit-testable without faking time.
Kept free of any `import "server-only"` transitive dependency, since both a
client component and its tests import it.

**List treatment** (`CompetitorList.tsx`): a gold `★ NEW` pill immediately before
the existing Opportunity chip, so a new opportunity shows both. Reuses the chip
idiom already in the file.

**Map treatment** (`MapView.tsx`): the diamond keeps its existing shape and
colour — filled caramel for opportunities, hollow taupe otherwise — and gains a
small gold star glyph plus a soft pulsing ring. Deliberately additive: it stacks
with the opportunity/plain distinction instead of replacing it, and avoids
introducing a fourth marker colour.

**DOM restructuring (the real work).** Today `competitorMarkerEl` builds
`outer > inner`, where `inner` carries the 45° rotation *and* the hover scale
(`inner.style.transform = "rotate(45deg) scale(1.35)"`). A star child of `inner`
would inherit the 45° rotation and render tilted. New nesting:

```
outer   ← positioned by MapTiler; transform NEVER touched; carries z-index
└─ inner    ← position: relative; carries hover scale ONLY
   ├─ diamond  ← all existing visuals + transform: rotate(45deg)
   └─ star     ← position: absolute, unrotated, gold glyph (new closures only)
```

Three sites currently write `rotate(45deg)` into `inner.style.transform` and all
must become plain `scale()`:

1. the `hoveredId` highlight effect (`rotate(45deg) scale(1.35)` / `rotate(45deg)`)
2. the marker's `mouseenter` (`rotate(45deg) scale(1.25)`)
3. the marker's `mouseleave` (`rotate(45deg)`)

Missing any one of them tilts or un-tilts a diamond on hover, so this is the
regression to watch in the Playwright pass.

The pulse ring is a keyframe animation added to `globals.css` (marker styles are
inline, but an inline `animation` can reference a globally-defined keyframe
name), respecting `prefers-reduced-motion`.

**Legend.** Add a "New closure" row to the competitor group in `MapLayerRows`
with a star swatch. It is a *key entry only*, not a toggle — there is no
`showNewClosures` filter flag, and inventing one is out of scope.

**Popup.** The existing map popup already renders `Detected <date>` from
`closedAt`. Unchanged — that line is exactly the honest framing, and the card
treatment for dates is out of scope per Parker's decision.

**Files:** new `src/lib/closure-recency.ts`; `src/components/browse/CompetitorList.tsx`,
`src/components/browse/MapView.tsx`, `src/components/browse/MapLegend.tsx`,
`src/app/globals.css`.

---

## Testing

**Unit (vitest):**

- `closure-recency`: null `closedAt`; inside the window; outside; the 14-day
  boundary from both sides; an unparseable date string (must not throw, must not
  flag new).
- Collapse gating: listings collapsible only when both sections render;
  expanded when competitors are hidden; expanded when there is no closure data.
  Extracted as a pure helper if the derivation is non-trivial, otherwise
  asserted through a component render.

**Type gate:** `tsc` after each change. Lint is broken pre-existing (unrelated),
and `next build` requires the dev server stopped on this Windows machine
(`.next` lock) — so `tsc` is the per-step gate.

**Playwright, 390px viewport** — the five presentation changes cannot be verified
by tests and must be screenshotted before any completion claim:

1. Top bar: no logo, search full-width, hamburger clear of the input.
2. Tab bar: five single-line labels, bar at its reserved height, the List pill
   and layers FAB both fully visible and tappable.
3. List view: "Hello Sugar listings" collapsed with its count badge; expands on
   tap; competitors visible without scrolling past it.
4. Map: a competitor diamond overlapping a Hello Sugar marker renders on top;
   marker icons match the new table; hover does not tilt a diamond.
5. A new closure (the one qualifying row, or a temporarily seeded `closedAt` in a
   local fixture) shows the star on the map and the NEW pill in the list.

Desktop (1280px) regression pass: header logo intact, legend swatches match the
map, layer ordering holds in the 1/3 + 2/3 split.

## Risks

- **Marker DOM restructuring** is the only change that can break existing
  behaviour. The MapTiler outer-transform constraint is documented in
  `MapView.tsx` for good reason (markers detach and jump to 0,0 if violated), and
  change 6 touches the exact element hierarchy that constraint governs. Mitigated
  by keeping `outer` untouched and by explicitly enumerating the three transform
  write sites above.
- **`z-index` base/hover interaction** — resetting to `""` instead of the base
  band would silently undo change 4 the first time anything is hovered.
- **Change 6 is near-invisible on today's data** (1 of 79 rows). Verification
  needs a seeded fixture, not a look at production, or it will read as "not
  working".
