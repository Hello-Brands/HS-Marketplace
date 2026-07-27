import { describe, it, expect } from "vitest"
import {
  groupUserLinkRows,
  linkSourceBadgeVariant,
  countMultiLinkUsers,
  addableOwners,
  type AdminUserRow,
} from "@/lib/owner-directory/admin-view"

describe("groupUserLinkRows", () => {
  it("collapses a left-joined result into one row per user", () => {
    expect(
      groupUserLinkRows([
        { id: "u1", name: "Austin", email: "austin@x.com", ownerIdentifier: "ut-lines-towns", source: "auto" },
        { id: "u1", name: "Austin", email: "austin@x.com", ownerIdentifier: "ut-towns", source: "auto" },
        { id: "u2", name: "Lisa", email: "lisa@x.com", ownerIdentifier: "az-ut-lines", source: "manual" },
      ])
    ).toEqual([
      {
        id: "u1",
        name: "Austin",
        email: "austin@x.com",
        links: [
          { ownerIdentifier: "ut-lines-towns", source: "auto" },
          { ownerIdentifier: "ut-towns", source: "auto" },
        ],
      },
      { id: "u2", name: "Lisa", email: "lisa@x.com", links: [{ ownerIdentifier: "az-ut-lines", source: "manual" }] },
    ])
  })

  it("keeps a user with no links, with an empty array (left join yields nulls)", () => {
    expect(
      groupUserLinkRows([
        { id: "u3", name: "Buyer", email: "buyer@x.com", ownerIdentifier: null, source: null },
      ])
    ).toEqual([{ id: "u3", name: "Buyer", email: "buyer@x.com", links: [] }])
  })

  it("sorts links by identifier so chip order is stable", () => {
    const [row] = groupUserLinkRows([
      { id: "u1", name: null, email: null, ownerIdentifier: "z-owner", source: "auto" },
      { id: "u1", name: null, email: null, ownerIdentifier: "a-owner", source: "auto" },
    ])
    expect(row.links.map((l) => l.ownerIdentifier)).toEqual(["a-owner", "z-owner"])
  })

  it("preserves user order from the query", () => {
    const rows = groupUserLinkRows([
      { id: "b", name: null, email: "b@x.com", ownerIdentifier: null, source: null },
      { id: "a", name: null, email: "a@x.com", ownerIdentifier: null, source: null },
    ])
    expect(rows.map((r) => r.id)).toEqual(["b", "a"])
  })

  it("keeps a revoked link in the output, alongside an effective one, with its source intact", () => {
    const [row] = groupUserLinkRows([
      { id: "u1", name: "Austin", email: "austin@x.com", ownerIdentifier: "ut-lines-towns", source: "auto" },
      { id: "u1", name: "Austin", email: "austin@x.com", ownerIdentifier: "ut-towns", source: "revoked" },
    ])
    expect(row.links).toEqual([
      { ownerIdentifier: "ut-lines-towns", source: "auto" },
      { ownerIdentifier: "ut-towns", source: "revoked" },
    ])
  })

  it("groups rows correctly even when a user's rows are interleaved with another user's", () => {
    const rows = groupUserLinkRows([
      { id: "u1", name: "Austin", email: "austin@x.com", ownerIdentifier: "ut-lines-towns", source: "auto" },
      { id: "u2", name: "Lisa", email: "lisa@x.com", ownerIdentifier: "az-ut-lines", source: "manual" },
      { id: "u1", name: "Austin", email: "austin@x.com", ownerIdentifier: "ut-towns", source: "auto" },
    ])
    expect(rows).toEqual([
      {
        id: "u1",
        name: "Austin",
        email: "austin@x.com",
        links: [
          { ownerIdentifier: "ut-lines-towns", source: "auto" },
          { ownerIdentifier: "ut-towns", source: "auto" },
        ],
      },
      { id: "u2", name: "Lisa", email: "lisa@x.com", links: [{ ownerIdentifier: "az-ut-lines", source: "manual" }] },
    ])
  })
})

describe("linkSourceBadgeVariant", () => {
  it.each([
    ["auto", "default"],
    ["manual", "primary"],
    ["revoked", "outline"],
  ] as const)("%s -> %s", (source, expected) => {
    expect(linkSourceBadgeVariant(source)).toBe(expected)
  })
})

describe("countMultiLinkUsers", () => {
  const row = (id: string, links: AdminUserRow["links"]): AdminUserRow => ({
    id, name: null, email: null, links,
  })

  it("counts users with two or more EFFECTIVE links", () => {
    expect(
      countMultiLinkUsers([
        row("a", [
          { ownerIdentifier: "o1", source: "auto" },
          { ownerIdentifier: "o2", source: "auto" },
        ]),
        row("b", [{ ownerIdentifier: "o1", source: "auto" }]),
        row("c", []),
      ])
    ).toBe(1)
  })

  it("does not count a revoked link toward the total", () => {
    expect(
      countMultiLinkUsers([
        row("a", [
          { ownerIdentifier: "o1", source: "auto" },
          { ownerIdentifier: "o2", source: "revoked" },
        ]),
      ])
    ).toBe(0)
  })
})

describe("addableOwners", () => {
  const all = [
    { ownerIdentifier: "o1", ownerName: "One" },
    { ownerIdentifier: "o2", ownerName: "Two" },
    { ownerIdentifier: "o3", ownerName: "Three" },
  ]

  it("excludes owners the user already effectively holds", () => {
    expect(
      addableOwners(all, [
        { ownerIdentifier: "o1", source: "auto" },
        { ownerIdentifier: "o2", source: "manual" },
      ]).map((o) => o.ownerIdentifier)
    ).toEqual(["o3"])
  })

  it("still offers an owner whose only link is revoked (re-linking is allowed)", () => {
    expect(
      addableOwners(all, [{ ownerIdentifier: "o1", source: "revoked" }]).map((o) => o.ownerIdentifier)
    ).toEqual(["o1", "o2", "o3"])
  })
})
