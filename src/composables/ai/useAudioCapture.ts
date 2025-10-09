/**
 * Audio Capture Composable
 * Manages audio capture lifecycle and state
 */

import { ref, reactive, onUnmounted } from 'vue'
import { AudioCapture } from '@/services/audio'
import type { AudioConfig, AudioChunk, MicrophonePermission } from '@/types/ai'

export function useAudioCapture(initialConfig?: Partial<AudioConfig>) {
  const config = reactive<AudioConfig>({
    ...({ sampleRate: 16000, channels: 1, bufferSize: 4096, echoCancellation: true, noiseSuppression: true, autoGainControl: true } as AudioConfig),
    ...initialConfig,
  })

  const isActive = ref(false)
  const permission = ref<MicrophonePermission>({ state: 'prompt' })
  const error = ref<string | null>(null)

  let audioCapture: AudioCapture | null = null
  const chunkCallbacks: Array<(chunk: AudioChunk) => void> = []
  const unsubscribers: Array<() => void> = []

  /**
   * Request microphone permission
   */
  const requestPermission = async (): Promise<MicrophonePermission> => {
    try {
      audioCapture = new AudioCapture(config)
      const result = await audioCapture.requestPermission()
      permission.value = result
      return result
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      error.value = errorMessage
      permission.value = { state: 'unknown', error: errorMessage }
      return permission.value
    }
  }

  /**
   * Start audio capture
   */
  const start = async (): Promise<void> => {
    try {
      error.value = null

      // Create audio capture if not exists
      if (!audioCapture) {
        audioCapture = new AudioCapture(config)
      }

      // Register chunk callbacks
      const unsubChunk = audioCapture.onChunk((chunk) => {
        chunkCallbacks.forEach((callback) => {
          try {
            callback(chunk)
          } catch (err) {
            console.error('[useAudioCapture] Chunk callback error:', err)
          }
        })
      })
      unsubscribers.push(unsubChunk)

      // Register error callback
      const unsubError = audioCapture.onError((err) => {
        error.value = err.message
        console.error('[useAudioCapture] Audio error:', err)
      })
      unsubscribers.push(unsubError)

      // Start capture
      await audioCapture.start()
      isActive.value = true

      console.log('[useAudioCapture] Started successfully')
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to start audio capture'
      console.error('[useAudioCapture] Start error:', err)
      throw err
    }
  }

  /**
   * Stop audio capture
   */
  const stop = (): void => {
    if (audioCapture) {
      audioCapture.stop()
      isActive.value = false
    }

    // Unsubscribe all
    unsubscribers.forEach((unsub) => unsub())
    unsubscribers.length = 0

    console.log('[useAudioCapture] Stopped')
  }

  /**
   * Register callback for audio chunks
   */
  const onChunk = (callback: (chunk: AudioChunk) => void): (() => void) => {
    chunkCallbacks.push(callback)

    // Return unsubscribe function
    return () => {
      const index = chunkCallbacks.indexOf(callback)
      if (index > -1) {
        chunkCallbacks.splice(index, 1)
      }
    }
  }

  /**
   * Update configuration (requires restart)
   */
  const updateConfig = (newConfig: Partial<AudioConfig>): void => {
    Object.assign(config, newConfig)

    if (audioCapture) {
      audioCapture.updateConfig(newConfig)
    }
  }

  /**
   * Cleanup on unmount
   */
  onUnmounted(() => {
    stop()
    audioCapture = null
    chunkCallbacks.length = 0
  })

  return {
    // State
    config,
    isActive,
    permission,
    error,

    // Methods
    requestPermission,
    start,
    stop,
    onChunk,
    updateConfig,
  }
}
