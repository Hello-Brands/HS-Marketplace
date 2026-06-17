# HS Marketplace — Database ER Diagram

A rendered image lives alongside this file at `database-erd.svg` (open in a browser).
The Mermaid source below is the editable version — it renders on GitHub and in most
Markdown editors. Money is stored in integer **cents**.

```mermaid
erDiagram
    users ||--o{ accounts          : "userId"
    users ||--o{ sessions          : "userId"
    users ||--o{ allowlist         : "addedBy"
    users ||--o{ listings          : "sellerId"
    users ||--o{ contacts          : "buyerId"
    users ||--o{ favorites         : "userId"
    users ||--o{ alerts            : "userId"
    listings ||--o{ listing_locations : "listingId"
    listings ||--o{ listing_photos    : "listingId"
    listings ||--o{ contacts          : "listingId"
    listings ||--o{ favorites         : "listingId"

    users {
        text id PK
        text email "unique"
        enum role "user | admin"
        bool sellerAccess
    }
    accounts {
        text provider PK
        text providerAccountId PK
        text userId FK
        text tokens "OAuth"
    }
    sessions {
        text sessionToken PK
        text userId FK
        timestamp expires
    }
    verification_tokens {
        text identifier "no FK (Auth.js, unused)"
        text token
        timestamp expires
    }
    allowlist {
        text id PK
        text email "unique"
        text addedBy FK
    }
    listings {
        text id PK
        text sellerId FK
        enum type "suite|flagship|territory|bundle"
        enum status "draft->pending->active->sold/delisted"
        int askingPrice "cents"
    }
    listing_locations {
        text id PK
        text listingId FK
        enum locationType "salon | territory"
        float latitude "geocoded"
        float longitude "geocoded"
        int ttmRevenue "cents (auto-populated)"
    }
    listing_photos {
        text id PK
        text listingId FK
        text url "Vercel Blob"
        int displayOrder "0 = cover"
    }
    contacts {
        text id PK
        text listingId FK
        text buyerId FK
        text message "+ buyer snapshot"
    }
    favorites {
        text id PK
        text userId FK
        text listingId FK
    }
    alerts {
        text id PK
        text userId FK
        json states "+ listingTypes"
        int maxPrice "cents"
    }
```

## Notes
- **`users`** and **`listings`** are the two hubs. `users` owns auth + all engagement
  rows; `listings` owns its locations/photos and the engagement that targets it.
- **`verification_tokens`** has no FK — it's a standard Auth.js table, unused with
  Google-only sign-in.
- **Not shown** (orphan tables left in the DB from early `drizzle-kit push`, not in the
  schema): `user_favorites`, `signed_ndas`, and a legacy `photos` table (the app uses
  `listing_photos`). Candidates for cleanup.
