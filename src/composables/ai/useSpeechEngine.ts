/**
 * useSpeechEngine composable
 * Wraps whisper-web service and speech activity pipeline
 */

import { ref, reactive, onUnmounted } from 'vue'
import type {
  SpeechConfig,
  SpeechEngineState,
  SpeechTranscript,
  SpeechBackend,
  SpeechProgress,
} from '@/types/ai'
import { DEFAULT_SPEECH_CONFIG } from '@/types/ai'
import { WhisperWebService, SpeechActivityPipeline } from '@/services/speech'
import type { AudioChunk } from '@/types/ai'

export function useSpeechEngine(initialConfig?: Partial<SpeechConfig>) {
  const config = reactive<SpeechConfig>({
    ...DEFAULT_SPEECH_CONFIG,
    ...initialConfig,
  })

  const service = new WhisperWebService()
  const pipeline = new SpeechActivityPipeline(service, config)

  const state = reactive<SpeechEngineState>({
    initialized: false,
    loading: false,
    backend: 'wasm',
    error: null,
    lastInferenceMs: 0,
  })

  const isSpeaking = ref(false)
  const probability = ref(0)
  const lastTranscript = ref<SpeechTranscript | null>(null)
  const progressItems = ref<SpeechProgress[]>([])

  const initialize = async (): Promise<void> => {
    try {
      state.error = null
      state.loading = true
      state.backend = await service.initialize(config)
      state.initialized = true
      state.loading = false
    } catch (error) {
      state.loading = false
      const message = error instanceof Error ? error.message : 'Speech engine initialization failed'
      state.error = message
      throw error
    }
  }

  const processAudioChunk = (chunk: AudioChunk): void => {
    if (!state.initialized || state.loading) {
      return
    }
    pipeline.enqueue(chunk)
  }

  const reset = (): void => {
    pipeline.reset()
    isSpeaking.value = false
    probability.value = 0
    lastTranscript.value = null
    progressItems.value = []
    state.lastInferenceMs = 0
    state.error = null
  }

  const destroy = (): void => {
    pipeline.destroy()
    service.destroy()
    state.initialized = false
    state.loading = false
    state.error = null
    progressItems.value = []
  }

  pipeline.on('speech-start', (event) => {
    isSpeaking.value = true
    probability.value = event.confidence
  })

  pipeline.on('speech-end', () => {
    isSpeaking.value = false
    probability.value = 0
  })

  pipeline.on('transcript', (event) => {
    lastTranscript.value = event.transcript
  })

  pipeline.on('progress', (event) => {
    const existingIndex = progressItems.value.findIndex((item) => item.file === event.progress.file)
    if (existingIndex >= 0) {
      progressItems.value[existingIndex] = event.progress
    } else {
      progressItems.value.push(event.progress)
    }
  })

  pipeline.on('inference-complete', (event) => {
    state.lastInferenceMs = event.elapsedMs
  })

  pipeline.on('error', (event) => {
    state.error = event.error.message
  })

  onUnmounted(() => {
    destroy()
  })

  return {
    config,
    state,
    isSpeaking,
    probability,
    lastTranscript,
    progressItems,
    initialize,
    processAudioChunk,
    reset,
    destroy,
    getBackend: (): SpeechBackend => state.backend,
    getLastTranscript: (): SpeechTranscript | null => lastTranscript.value,
  }
}
