/**
 * Text normalization utilities for alignment
 */

/**
 * Normalize text for comparison
 */
export function normalizeText(text: string, caseSensitive = false): string {
  let normalized = text

  // Convert to lowercase if not case sensitive
  if (!caseSensitive) {
    normalized = normalized.toLowerCase()
  }

  // Remove punctuation
  normalized = normalized.replace(/[^\w\s']|_/g, ' ')

  // Normalize whitespace
  normalized = normalized.replace(/\s+/g, ' ').trim()

  return normalized
}

/**
 * Split text into words
 */
export function tokenizeText(text: string): string[] {
  return normalizeText(text)
    .split(/\s+/)
    .filter((word) => word.length > 0)
}

/**
 * Remove common filler words
 */
const FILLER_WORDS = new Set([
  'um',
  'uh',
  'like',
  'you know',
  'i mean',
  'sort of',
  'kind of',
  'basically',
  'actually',
  'literally',
])

export function removeFillers(words: string[]): string[] {
  return words.filter((word) => !FILLER_WORDS.has(word.toLowerCase()))
}

/**
 * Compute Levenshtein distance (edit distance) between two strings
 */
export function levenshteinDistance(s1: string, s2: string): number {
  const len1 = s1.length
  const len2 = s2.length

  // Create a 2D array for dynamic programming
  const dp: number[][] = Array.from({ length: len1 + 1 }, () =>
    Array(len2 + 1).fill(0)
  )

  // Initialize first row and column
  for (let i = 0; i <= len1; i++) {
    dp[i][0] = i
  }
  for (let j = 0; j <= len2; j++) {
    dp[0][j] = j
  }

  // Fill in the rest of the matrix
  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1

      dp[i][j] = Math.min(
        dp[i - 1][j] + 1, // deletion
        dp[i][j - 1] + 1, // insertion
        dp[i - 1][j - 1] + cost // substitution
      )
    }
  }

  return dp[len1][len2]
}

/**
 * Compute similarity score between two strings (0-1)
 */
export function similarityScore(s1: string, s2: string): number {
  const distance = levenshteinDistance(s1, s2)
  const maxLen = Math.max(s1.length, s2.length)

  if (maxLen === 0) return 1

  return 1 - distance / maxLen
}

/**
 * Compute word sequence similarity (for alignment)
 */
export function wordSequenceSimilarity(words1: string[], words2: string[]): number {
  const str1 = words1.join(' ')
  const str2 = words2.join(' ')

  return similarityScore(str1, str2)
}

/**
 * Find best match position for a sequence of words in a larger text
 */
export function findBestMatch(
  needle: string[],
  haystack: string[],
  startIndex = 0
): { index: number; score: number } {
  let bestMatch = { index: startIndex, score: 0 }

  const needleLen = needle.length

  // Search through haystack
  for (let i = startIndex; i <= haystack.length - needleLen; i++) {
    const slice = haystack.slice(i, i + needleLen)
    const score = wordSequenceSimilarity(needle, slice)

    if (score > bestMatch.score) {
      bestMatch = { index: i, score }
    }

    // Early exit if perfect match
    if (score > 0.95) {
      break
    }
  }

  return bestMatch
}

/**
 * Compute longest common subsequence length
 */
export function longestCommonSubsequence(arr1: string[], arr2: string[]): number {
  const m = arr1.length
  const n = arr2.length

  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (arr1[i - 1] === arr2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }

  return dp[m][n]
}

/**
 * Check if two words are phonetically similar (simple heuristic)
 */
export function arePhoneticallySimilar(word1: string, word2: string): boolean {
  // Normalize
  const w1 = word1.toLowerCase()
  const w2 = word2.toLowerCase()

  // Exact match
  if (w1 === w2) return true

  // Check if one is substring of other (handles partial recognition)
  if (w1.includes(w2) || w2.includes(w1)) return true

  // Check similarity threshold
  const sim = similarityScore(w1, w2)
  return sim > 0.7
}

/**
 * Clean up recognized text (remove artifacts)
 */
export function cleanRecognizedText(text: string): string {
  return text
    .replace(/\[inaudible\]/gi, '')
    .replace(/\[music\]/gi, '')
    .replace(/\[applause\]/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}
