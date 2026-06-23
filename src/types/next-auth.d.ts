import "next-auth"

declare module "next-auth" {
  interface User {
    role?: "user" | "admin"
    sellerAccess?: boolean
    ownerIdentifier?: string | null
  }
  interface Session {
    user: {
      id?: string
      role?: "user" | "admin"
      sellerAccess?: boolean
      ownerIdentifier?: string | null
    } & import("next-auth").DefaultSession["user"]
  }
}

declare module "@auth/core/adapters" {
  interface AdapterUser {
    role?: "user" | "admin"
    sellerAccess?: boolean
    ownerIdentifier?: string | null
  }
}
