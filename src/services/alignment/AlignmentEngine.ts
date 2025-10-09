/**
 * Alignment Engine - Tracks speaker position in transcript
 */

import { normalizeText, findBestMatch } from '@/utils/textNormalization'
import type {
  AlignmentConfig,
  AlignmentResult,
  AlignmentState,
  IAlignmentEngine,
} from '@/types/ai'

export class AlignmentEngine implements IAlignmentEngine {
  private config: AlignmentConfig
  private transcript: string[] = []
  private state: AlignmentState = {
    currentPosition: 0,
    lastConfidentPosition: 0,
    rollingWindow: [],
    confidence: 0,
    status: 'lost',
    totalWords: 0,
  }

  constructor(config: AlignmentConfig) {
    this.config = config
  }

  initialize(transcript: string[], config?: AlignmentConfig): void {
    if (config) {
      this.config = config
    }

    // Normalize transcript
    this.transcript = transcript.map((word) =>
      normalizeText(word, this.config.caseSensitive)
    )

    this.state.totalWords = this.transcript.length
    this.reset()

    console.log('[AlignmentEngine] Initialized with', this.transcript.length, 'words')
  }

  addWord(word: string, _timestamp: number): AlignmentResult {
    // Normalize the recognized word
    const normalizedWord = normalizeText(word, this.config.caseSensitive)

    // Add to rolling window
    this.state.rollingWindow.push(normalizedWord)
    if (this.state.rollingWindow.length > this.config.windowSize) {
      this.state.rollingWindow.shift()
    }

    // Find best match in transcript
    const match = findBestMatch(
      this.state.rollingWindow,
      this.transcript,
      this.state.currentPosition
    )

    // Calculate confidence
    const confidence = match.score

    // Update position if confidence meets threshold
    if (confidence >= this.config.confidenceThreshold) {
      const newPosition = match.index

      // Check for backward jump
      if (newPosition < this.state.currentPosition) {
        // Apply penalty
        if (confidence < this.config.backwardJumpPenalty) {
          // Don't update position
          console.warn('[AlignmentEngine] Backward jump rejected:', newPosition)
        } else {
          this.state.currentPosition = newPosition
          this.state.lastConfidentPosition = newPosition
        }
      } else {
        // Forward movement or allowed jump
        this.state.currentPosition = newPosition
        this.state.lastConfidentPosition = newPosition
      }

      this.state.confidence = confidence
    } else {
      // Low confidence - maintain last known position
      this.state.confidence = confidence
    }

    // Update status
    this.updateStatus()

    // Calculate lead (how many words ahead of current position)
    const lead = this.state.rollingWindow.length

    return {
      position: this.state.currentPosition,
      confidence: this.state.confidence,
      matchedWords: [...this.state.rollingWindow],
      transcriptWords: this.transcript.slice(
        this.state.currentPosition,
        this.state.currentPosition + this.config.windowSize
      ),
      lead,
    }
  }

  private updateStatus(): void {
    if (this.state.confidence >= 0.8) {
      this.state.status = 'good'
    } else if (this.state.confidence >= 0.6) {
      this.state.status = 'uncertain'
    } else {
      this.state.status = 'lost'
    }
  }

  reset(): void {
    this.state.currentPosition = 0
    this.state.lastConfidentPosition = 0
    this.state.rollingWindow = []
    this.state.confidence = 0
    this.state.status = 'lost'
    console.log('[AlignmentEngine] State reset')
  }

  getState(): AlignmentState {
    return { ...this.state }
  }

  setPosition(position: number): void {
    if (position >= 0 && position < this.transcript.length) {
      this.state.currentPosition = position
      this.state.lastConfidentPosition = position
      console.log('[AlignmentEngine] Position manually set to', position)
    }
  }
}
