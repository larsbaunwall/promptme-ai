/**
 * Alignment Composable
 * Manages text alignment and position tracking
 */

import { ref, reactive, computed, onUnmounted } from 'vue'
import { AlignmentEngine } from '@/services/alignment/AlignmentEngine'
import { tokenizeText } from '@/utils/textNormalization'
import type { AlignmentConfig, AlignmentResult, AlignmentState } from '@/types/ai'

export function useAlignment(initialConfig?: Partial<AlignmentConfig>) {
  const config = reactive<AlignmentConfig>({
    ...({ windowSize: 15, confidenceThreshold: 0.6, allowForwardJumps: true, backwardJumpPenalty: 0.8, smoothingFactor: 0.3, normalizeText: true, caseSensitive: false } as AlignmentConfig),
    ...initialConfig,
  })

  const isInitialized = ref(false)
  const currentResult = ref<AlignmentResult | null>(null)

  let engine: AlignmentEngine | null = null

  // Computed state
  const state = computed<AlignmentState | null>(() => {
    return engine ? engine.getState() : null
  })

  const currentPosition = computed(() => state.value?.currentPosition ?? 0)
  const confidence = computed(() => state.value?.confidence ?? 0)
  const status = computed(() => state.value?.status ?? 'lost')

  /**
   * Initialize with transcript text
   */
  const initialize = (transcriptText: string): void => {
    const words = tokenizeText(transcriptText)

    if (words.length === 0) {
      throw new Error('Transcript is empty after tokenization')
    }

    engine = new AlignmentEngine(config)
    engine.initialize(words, config)

    isInitialized.value = true
    console.log('[useAlignment] Initialized with', words.length, 'words')
  }

  /**
   * Process a recognized word
   */
  const addWord = (word: string, timestamp: number): AlignmentResult => {
    if (!engine || !isInitialized.value) {
      throw new Error('Alignment engine not initialized')
    }

    const result = engine.addWord(word, timestamp)
    currentResult.value = result

    return result
  }

  /**
   * Process multiple words at once
   */
  const addWords = (words: { word: string; timestamp: number }[]): AlignmentResult | null => {
    if (!engine || !isInitialized.value) {
      throw new Error('Alignment engine not initialized')
    }

    let lastResult: AlignmentResult | null = null

    for (const { word, timestamp } of words) {
      lastResult = engine.addWord(word, timestamp)
    }

    if (lastResult) {
      currentResult.value = lastResult
    }

    return lastResult
  }

  /**
   * Manually set position in transcript
   */
  const setPosition = (position: number): void => {
    if (!engine) {
      throw new Error('Alignment engine not initialized')
    }

    engine.setPosition(position)
    console.log('[useAlignment] Position manually set to', position)
  }

  /**
   * Reset alignment state
   */
  const reset = (): void => {
    if (engine) {
      engine.reset()
      currentResult.value = null
      console.log('[useAlignment] State reset')
    }
  }

  /**
   * Update configuration
   */
  const updateConfig = (newConfig: Partial<AlignmentConfig>): void => {
    Object.assign(config, newConfig)

    if (engine) {
      // Reinitialize with new config if already initialized
      const currentState = engine.getState()
      if (currentState.totalWords > 0) {
        console.log('[useAlignment] Updating config, requires reinitialization')
      }
    }
  }

  /**
   * Destroy alignment engine
   */
  const destroy = (): void => {
    engine = null
    isInitialized.value = false
    currentResult.value = null
    console.log('[useAlignment] Destroyed')
  }

  // Cleanup on unmount
  onUnmounted(() => {
    destroy()
  })

  return {
    // State
    config,
    isInitialized,
    state,
    currentPosition,
    confidence,
    status,
    currentResult,

    // Methods
    initialize,
    addWord,
    addWords,
    setPosition,
    reset,
    updateConfig,
    destroy,
  }
}
