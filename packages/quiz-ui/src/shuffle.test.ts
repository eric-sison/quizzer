import { describe, expect, it } from "vitest"

import { seededShuffle } from "./shuffle"

const ITEMS = ["a", "b", "c", "d", "e", "f", "g", "h"]

describe("seededShuffle", () => {
  it("is deterministic in the seed", () => {
    expect(seededShuffle(ITEMS, "seed-1")).toEqual(seededShuffle(ITEMS, "seed-1"))
  })

  it("is a complete permutation - nothing lost, nothing duplicated", () => {
    const shuffled = seededShuffle(ITEMS, "any-seed")
    expect([...shuffled].sort()).toEqual([...ITEMS].sort())
    expect(new Set(shuffled).size).toBe(ITEMS.length)
  })

  it("does not mutate its input", () => {
    const input = [...ITEMS]
    seededShuffle(input, "seed")
    expect(input).toEqual(ITEMS)
  })

  it("different seeds usually give different orders", () => {
    const orders = new Set(
      Array.from({ length: 20 }, (_, i) => seededShuffle(ITEMS, `seed-${i}`).join(""))
    )
    // 20 seeds over 8! permutations colliding into one bucket would mean the
    // seed is being ignored.
    expect(orders.size).toBeGreaterThan(1)
  })
})
