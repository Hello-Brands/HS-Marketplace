import { describe, it, expect } from "vitest"
import { decideOwnerLink } from "@/lib/owner-directory/link"

describe("decideOwnerLink", () => {
  it("links when exactly one distinct owner matches", () => {
    expect(
      decideOwnerLink({ matchedOwnerIdentifiers: ["al-la-koehn"], currentLinkSource: null })
    ).toEqual({ action: "link", ownerIdentifier: "al-la-koehn" })
  })

  it("collapses duplicate identifiers (one owner, multiple emails/rows) to a single link", () => {
    expect(
      decideOwnerLink({
        matchedOwnerIdentifiers: ["az-corp", "az-corp", "az-corp"],
        currentLinkSource: null,
      })
    ).toEqual({ action: "link", ownerIdentifier: "az-corp" })
  })

  it("skips with no_match when zero owners match", () => {
    expect(
      decideOwnerLink({ matchedOwnerIdentifiers: [], currentLinkSource: null })
    ).toEqual({ action: "skip", reason: "no_match" })
  })

  it("skips with multiple_owners when distinct owners are ambiguous", () => {
    expect(
      decideOwnerLink({
        matchedOwnerIdentifiers: ["owner-a", "owner-b"],
        currentLinkSource: null,
      })
    ).toEqual({ action: "skip", reason: "multiple_owners" })
  })

  it("never overwrites a manual link, even with a single clean match", () => {
    expect(
      decideOwnerLink({ matchedOwnerIdentifiers: ["al-la-koehn"], currentLinkSource: "manual" })
    ).toEqual({ action: "skip", reason: "manual_locked" })
  })

  it("re-links an existing auto link (auto is not locked)", () => {
    expect(
      decideOwnerLink({ matchedOwnerIdentifiers: ["new-owner"], currentLinkSource: "auto" })
    ).toEqual({ action: "link", ownerIdentifier: "new-owner" })
  })
})
