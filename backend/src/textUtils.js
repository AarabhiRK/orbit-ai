const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "into",
  "your",
  "are",
  "was",
  "but",
  "not",
  "you",
  "all",
  "can",
  "has",
  "have",
  "been",
  "than",
  "its",
  "our",
  "out",
  "day",
  "get",
  "use",
  "may",
  "any",
  "via",
  "well",
])

export function tokenize(text) {
  if (!text) return []
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t))
}

export function uniqueTokenSet(parts) {
  const set = new Set()
  for (const p of parts) for (const t of tokenize(p)) set.add(t)
  return set
}

export function jaccard(a, b) {
  if (a.size === 0 && b.size === 0) return 0
  let inter = 0
  for (const x of a) if (b.has(x)) inter += 1
  const union = a.size + b.size - inter
  return union === 0 ? 0 : inter / union
}
