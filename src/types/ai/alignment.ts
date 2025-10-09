/**
 * Text alignment type definitions
 */

export interface AlignmentConfig {
  windowSize: number // Number of words in rolling window
  confidenceThreshold: number // 0-1, minimum confidence to update position
  allowForwardJumps: boolean
  backwardJumpPenalty: number // 0-1, penalty for backward jumps
  smoothingFactor: number // 0-1, smoothing for position updates
  normalizeText: boolean
  caseSensitive: boolean
}

export interface AlignmentResult {
  position: number // Word index in transcript
  confidence: number // 0-1
  matchedWords: string[]
  transcriptWords: string[]
  lead: number // Words ahead of current position
}

export interface AlignmentState {
  currentPosition: number
  lastConfidentPosition: number
  rollingWindow: string[]
  confidence: number
  status: 'good' | 'uncertain' | 'lost'
  totalWords: number
}

export interface TextMatch {
  position: number
  score: number
  matchedCount: number
}

export const DEFAULT_ALIGNMENT_CONFIG: AlignmentConfig = {
  windowSize: 15,
  confidenceThreshold: 0.6,
  allowForwardJumps: true,
  backwardJumpPenalty: 0.8,
  smoothingFactor: 0.3,
  normalizeText: true,
  caseSensitive: false,
}

export interface IAlignmentEngine {
  initialize(transcript: string[], config: AlignmentConfig): void
  addWord(word: string, timestamp: number): AlignmentResult
  reset(): void
  getState(): AlignmentState
  setPosition(position: number): void
}
