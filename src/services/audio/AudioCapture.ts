/**
 * Audio Capture Service
 * Handles microphone access and audio stream processing
 */

import type { AudioConfig, AudioChunk, MicrophonePermission } from '@/types/ai'

export class AudioCapture {
  private config: AudioConfig
  private stream: MediaStream | null = null
  private audioContext: AudioContext | null = null
  private sourceNode: MediaStreamAudioSourceNode | null = null
  private workletNode: AudioWorkletNode | null = null
  private isCapturing = false

  private chunkCallbacks: Array<(chunk: AudioChunk) => void> = []
  private errorCallbacks: Array<(error: Error) => void> = []

  constructor(config: AudioConfig) {
    this.config = config
  }

  /**
   * Request microphone permission and check status
   */
  async requestPermission(): Promise<MicrophonePermission> {
    try {
      // Check if MediaDevices API is available
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        return {
          state: 'unknown',
          error: 'MediaDevices API not available in this browser',
        }
      }

      // Try to get permission
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: this.config.channels,
          sampleRate: this.config.sampleRate,
          echoCancellation: this.config.echoCancellation,
          noiseSuppression: this.config.noiseSuppression,
          autoGainControl: this.config.autoGainControl,
        },
      })

      // Permission granted, stop the stream (we'll create a new one when starting)
      stream.getTracks().forEach((track) => track.stop())

      return { state: 'granted' }
    } catch (error) {
      console.error('[AudioCapture] Permission error:', error)

      if (error instanceof Error && error.name === 'NotAllowedError') {
        return {
          state: 'denied',
          error: 'Microphone permission denied by user',
        }
      }

      return {
        state: 'unknown',
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Start capturing audio from microphone
   */
  async start(): Promise<void> {
    if (this.isCapturing) {
      console.warn('[AudioCapture] Already capturing')
      return
    }

    try {
      console.log('[AudioCapture] Starting audio capture...')

      // Get microphone stream
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: this.config.channels,
          sampleRate: this.config.sampleRate,
          echoCancellation: this.config.echoCancellation,
          noiseSuppression: this.config.noiseSuppression,
          autoGainControl: this.config.autoGainControl,
        },
      })

      // Create audio context
      this.audioContext = new AudioContext({
        sampleRate: this.config.sampleRate,
      })

      // Add the audio worklet module
      await this.audioContext.audioWorklet.addModule('/worklets/audio-processor.js')

      // Create the worklet node
  this.workletNode = new AudioWorkletNode(this.audioContext, 'audio-processor')
  this.workletNode.port.start?.()

      // Connect the source to the worklet
      this.sourceNode = this.audioContext.createMediaStreamSource(this.stream)
      this.sourceNode.connect(this.workletNode)

      // The worklet node is connected to the destination to keep it alive
      this.workletNode.connect(this.audioContext.destination)

      // Handle messages from the worklet
      this.workletNode.port.onmessage = (event: MessageEvent<Float32Array>) => {
        if (!this.isCapturing) return
        const received = event.data instanceof Float32Array ? event.data : new Float32Array(event.data)
        const chunkData = new Float32Array(received)
        const durationSeconds = chunkData.length / this.config.sampleRate
        const chunk: AudioChunk = {
          data: chunkData,
          timestamp: Date.now(),
          duration: durationSeconds,
        }

        this.chunkCallbacks.forEach((callback) => {
          try {
            callback(chunk)
          } catch (error) {
            console.error('[AudioCapture] Callback error:', error)
          }
        })
      }

      this.isCapturing = true
      console.log('[AudioCapture] Audio capture started successfully')
    } catch (error) {
      console.error('[AudioCapture] Failed to start:', error)
      this.emitError(error instanceof Error ? error : new Error(String(error)))
      throw error
    }
  }

  /**
   * Stop capturing audio
   */
  stop(): void {
    console.log('[AudioCapture] Stopping audio capture...')

    this.isCapturing = false

    // Disconnect nodes
    if (this.workletNode) {
      this.workletNode.port.onmessage = null
      this.workletNode.disconnect()
      this.workletNode = null
    }

    if (this.sourceNode) {
      this.sourceNode.disconnect()
      this.sourceNode = null
    }

    // Close audio context
    if (this.audioContext) {
      this.audioContext.close()
      this.audioContext = null
    }

    // Stop stream tracks
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop())
      this.stream = null
    }

    console.log('[AudioCapture] Audio capture stopped')
  }

  /**
   * Register callback for audio chunks
   */
  onChunk(callback: (chunk: AudioChunk) => void): () => void {
    this.chunkCallbacks.push(callback)

    // Return unsubscribe function
    return () => {
      const index = this.chunkCallbacks.indexOf(callback)
      if (index > -1) {
        this.chunkCallbacks.splice(index, 1)
      }
    }
  }

  /**
   * Register callback for errors
   */
  onError(callback: (error: Error) => void): () => void {
    this.errorCallbacks.push(callback)

    // Return unsubscribe function
    return () => {
      const index = this.errorCallbacks.indexOf(callback)
      if (index > -1) {
        this.errorCallbacks.splice(index, 1)
      }
    }
  }

  /**
   * Emit error to callbacks
   */
  private emitError(error: Error): void {
    this.errorCallbacks.forEach((callback) => {
      try {
        callback(error)
      } catch (err) {
        console.error('[AudioCapture] Error callback failed:', err)
      }
    })
  }

  /**
   * Check if currently capturing
   */
  isActive(): boolean {
    return this.isCapturing
  }

  /**
   * Get current configuration
   */
  getConfig(): AudioConfig {
    return { ...this.config }
  }

  /**
   * Update configuration (requires restart to take effect)
   */
  updateConfig(newConfig: Partial<AudioConfig>): void {
    Object.assign(this.config, newConfig)
  }
}
