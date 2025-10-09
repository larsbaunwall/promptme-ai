/**
 * Speech Tracking Orchestrator
 * Coordinates whisper-web speech engine, alignment, and pacing
 */

import { ref, reactive, onUnmounted, watch } from 'vue'
import { useAudioCapture } from './useAudioCapture'
import { useSpeechEngine } from './useSpeechEngine'
import { useAlignment } from './useAlignment'
import { usePacing } from './usePacing'
import type { SpeechTranscript } from '@/types/ai'

export function useSpeechTracking() {
  const audio = useAudioCapture()
  const speech = useSpeechEngine()
  const alignment = useAlignment()
  const pacing = usePacing()

  const isInitialized = ref(false)
  const isActive = ref(false)
  const error = ref<string | null>(null)

  const currentScrollPosition = ref(0)
  const estimatedScrollWordIndex = ref(0)

  const metrics = reactive({
    speechLatency: 0,
    alignmentLatency: 0,
    totalLatency: 0,
    fps: 60,
  })

  const currentWordIndex = ref(0)
  const currentWord = ref<string | null>(null)
  const isSpeaking = ref(false)

  let audioUnsubscribe: (() => void) | null = null
  const transcript = ref('')
  let lastProcessedEndTime = 0

  const initialize = async (transcriptText: string): Promise<void> => {
    try {
      error.value = null
      transcript.value = transcriptText
      alignment.initialize(transcriptText)
      pacing.initialize()
      await speech.initialize()

      isInitialized.value = true
      lastProcessedEndTime = 0
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Initialization failed'
      error.value = message
      throw err
    }
  }

  const start = async (): Promise<void> => {
    if (!isInitialized.value) {
      if (!transcript.value) {
        throw new Error('Speech tracking must be initialized with a transcript before starting')
      }
      await initialize(transcript.value)
    }

    try {
      if (audioUnsubscribe) {
        audioUnsubscribe()
        audioUnsubscribe = null
      }

      audioUnsubscribe = audio.onChunk((chunk) => {
        const startTime = window.performance.now()
        speech.processAudioChunk(chunk)
        metrics.totalLatency = window.performance.now() - startTime
      })

      await audio.start()
      isActive.value = true
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start speech tracking'
      error.value = message
      throw err
    }
  }

  const stop = (): void => {
    if (!isActive.value) return
    audio.stop()
    if (audioUnsubscribe) {
      audioUnsubscribe()
      audioUnsubscribe = null
    }
    speech.reset()
    isActive.value = false
  }

  watch(speech.isSpeaking, (speaking) => {
    isSpeaking.value = speaking
  })

  watch(speech.lastTranscript, (transcript) => {
    handleTranscript(transcript)
  })

  const handleTranscript = (transcript: SpeechTranscript | null): void => {
    if (!transcript) {
      return
    }

    const cleanedText = transcript.text?.trim() ?? ''
    const fallbackWords = cleanedText.length > 0 ? cleanedText.split(/\s+/).filter(Boolean) : []

    const segments =
      transcript.segments.length > 0
        ? transcript.segments
        : fallbackWords.length > 0
        ? [
            {
              text: cleanedText,
              words: fallbackWords.map((word, index) => {
                const segmentDuration = Math.max(fallbackWords.length * 0.18, 0.5)
                const wordDuration = segmentDuration / fallbackWords.length
                const start = index * wordDuration
                const end = index === fallbackWords.length - 1 ? segmentDuration : start + wordDuration
                return {
                  word,
                  start,
                  end,
                  confidence: 0.85,
                }
              }),
              start: 0,
              end: Math.max(fallbackWords.length * 0.18, 0.5),
              confidence: 0.85,
            },
          ]
        : []

    if (segments.length === 0) {
      return
    }

    const words = segments.flatMap((segment) =>
      segment.words.map((word) => ({
        text: word.word.trim(),
        start: word.start ?? segment.start ?? 0,
        end: word.end ?? segment.end ?? word.start ?? segment.start ?? 0,
        confidence: word.confidence ?? segment.confidence ?? 0.85,
      }))
    )

    if (words.length === 0) {
      return
    }

    const firstStart = words[0].start
    if (firstStart + 0.5 < lastProcessedEndTime) {
      lastProcessedEndTime = 0
    }

    for (const word of words) {
      if (!word.text) continue
      const endTime = Number.isFinite(word.end) ? word.end : word.start
      if (endTime <= lastProcessedEndTime + 1e-3) {
        continue
      }

      const alignStart = window.performance.now()
      const alignResult = alignment.addWord(word.text, word.start)
      metrics.alignmentLatency = window.performance.now() - alignStart
      metrics.speechLatency = speech.state.lastInferenceMs
      metrics.totalLatency = metrics.speechLatency + metrics.alignmentLatency

      currentWordIndex.value = alignResult.position
      currentWord.value = word.text

      if (pacing.isActive.value) {
        pacing.update(currentWordIndex.value, estimatedScrollWordIndex.value, alignResult.confidence)
      }

      lastProcessedEndTime = endTime
    }
  }

  const updateScrollPosition = (scrollPixels: number, fontSize: number, totalWords: number): void => {
    currentScrollPosition.value = scrollPixels
    const lineHeight = fontSize * 1.5
    const wordsPerLine = 10
    const estimatedLine = Math.abs(scrollPixels) / lineHeight
    const estimatedIndex = Math.floor(estimatedLine * wordsPerLine)
    estimatedScrollWordIndex.value = Math.max(0, Math.min(estimatedIndex, totalWords - 1))
  }

  const reset = (): void => {
    speech.reset()
    alignment.reset()
    pacing.reset()
    currentWordIndex.value = 0
    currentWord.value = null
    lastProcessedEndTime = 0
  }

  const setTranscript = (newTranscript: string): void => {
    transcript.value = newTranscript
  }

  const destroy = (): void => {
    stop()
    speech.destroy()
    alignment.destroy()
    pacing.destroy()
    isInitialized.value = false
  }

  watch(
    () => speech.isSpeaking.value,
    (value) => {
      isSpeaking.value = value
    }
  )

  watch(
    () => speech.lastTranscript.value,
    (transcript) => {
      handleTranscript(transcript)
    }
  )

  watch(
    () => speech.state.lastInferenceMs,
    (value) => {
      metrics.speechLatency = value
    }
  )

  onUnmounted(() => {
    destroy()
  })

  return {
    isInitialized,
    isActive,
    error,
    isSpeaking,
    currentWordIndex,
    currentWord,
    performance: metrics,
    audio,
    speech,
    alignment,
    pacing,
    initialize,
    start,
    stop,
    updateScrollPosition,
    setTranscript,
    reset,
    destroy,
  }
}
