/**
 * Deterministic display-order shuffling for `shuffle_questions` and
 * `shuffle_options`.
 *
 * Determinism is the point: `QuestionView` remounts on every navigation, so a
 * per-mount random order would reshuffle every time a student pressed
 * Previous. The shell (preview page or exam screen) holds one random seed per
 * sitting; the same seed always yields the same permutation, so the order is
 * stable for that student and different between students.
 *
 * Not cryptographic and does not need to be - answers are graded by id, so
 * display order carries no secret.
 */

/** FNV-1a, 32-bit. */
export function hashString(input: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** mulberry32: tiny seedable PRNG, plenty for display order. */
function mulberry32(seed: number): () => number {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Fisher-Yates over a copy; the input is never mutated. */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const random = mulberry32(hashString(seed))
  const result = [...items]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    const a = result[i] as T
    result[i] = result[j] as T
    result[j] = a
  }
  return result
}
