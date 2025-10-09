/**
 * Speech activity pipeline
 * Buffers audio chunks and streams them through whisper-web service
 */

import { concatenateAudio, resampleAudio } from '@/services/audio/AudioProcessor'
import type {
  SpeechConfig,
  SpeechEngineEvent,
  SpeechTranscript,
} from '@/types/ai'
import { WhisperWebService } from './WhisperWebService'
import type { AudioChunk } from '@/types/ai'

type EventHandler<T extends SpeechEngineEvent['type']> = Extract<
  SpeechEngineEvent,
  { type: T }
> extends { type: T }
  ? (event: Extract<SpeechEngineEvent, { type: T }>) => void
  : never

export class SpeechActivityPipeline {
  private readonly service: WhisperWebService
  private readonly config: SpeechConfig

  private audioBuffers: Float32Array[] = []
  private bufferedDurationMs = 0
  private processing = false
  private pendingFlush = false

  private isSpeaking = false
  private probability = 0
  private lastSpeechTimestamp: number | null = null
  private silenceTimeout: ReturnType<typeof setTimeout> | null = null

  private listeners = new Map<SpeechEngineEvent['type'], Set<Function>>()

  constructor(service: WhisperWebService, config: SpeechConfig) {
    this.service = service
    this.config = config
  }

  on<T extends SpeechEngineEvent['type']>(type: T, handler: EventHandler<T>): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set())
    }
    const set = this.listeners.get(type)!
    set.add(handler)
    return () => {
      set.delete(handler)
    }
  }

  enqueue(chunk: AudioChunk): void {
    this.audioBuffers.push(chunk.data)
    this.bufferedDurationMs += chunk.duration * 1000

    if (this.bufferedDurationMs >= this.config.chunkDuration) {
      this.flush()
    }
  }

  reset(): void {
    this.audioBuffers = []
    this.bufferedDurationMs = 0
    this.processing = false
    this.pendingFlush = false
    this.setSpeaking(false, 0)
    if (this.silenceTimeout !== null) {
      window.clearTimeout(this.silenceTimeout)
      this.silenceTimeout = null
    }
  }

  destroy(): void {
    this.reset()
    this.listeners.clear()
    if (this.silenceTimeout !== null) {
      window.clearTimeout(this.silenceTimeout)
      this.silenceTimeout = null
    }
  }

  private flush(): void {
    if (this.processing) {
      this.pendingFlush = true
      return
    }

    const { buffer, durationMs } = this.drainBuffers()
    if (!buffer) {
      return
    }

    this.pendingFlush = false
    this.processing = true
    this.emit({ type: 'inference-start' })

    const targetSampleRate = 16000
    const estimatedSampleRate = durationMs > 0 ? Math.round(buffer.length / (durationMs / 1000)) : targetSampleRate
    const processedBuffer = estimatedSampleRate && estimatedSampleRate !== targetSampleRate
      ? resampleAudio(buffer, estimatedSampleRate, targetSampleRate)
      : buffer

    this.service
      .transcribe(processedBuffer, {
        onUpdate: (transcript) => this.handleTranscript(transcript),
        onProgress: (progress) => this.emit({ type: 'progress', progress }),
      })
      .then((transcript) => {
        this.handleTranscript(transcript)
        this.emit({
          type: 'inference-complete',
          elapsedMs: this.service.getLastInferenceMs(),
        })
      })
      .catch((error) => {
        this.emit({ type: 'error', error: error instanceof Error ? error : new Error(String(error)) })
      })
      .finally(() => {
        this.processing = false
        if (this.pendingFlush && this.audioBuffers.length > 0) {
          this.flush()
        }
      })
  }

  private drainBuffers(): { buffer: Float32Array | null; durationMs: number } {
    if (this.audioBuffers.length === 0) {
      return { buffer: null, durationMs: 0 }
    }

    const combined = concatenateAudio(...this.audioBuffers)
    const durationMs = this.bufferedDurationMs
    this.audioBuffers = []
    this.bufferedDurationMs = 0
    return { buffer: combined, durationMs }
  }

  private handleTranscript(transcript: SpeechTranscript): void {
    this.emit({ type: 'transcript', transcript })

    if (!transcript.text || transcript.text.trim().length === 0) {
      return
    }

    const now = Date.now()
    this.lastSpeechTimestamp = now
    const confidence = this.estimateConfidence(transcript)
    this.setSpeaking(true, confidence)

    if (this.silenceTimeout !== null) {
      window.clearTimeout(this.silenceTimeout)
      this.silenceTimeout = null
    }

    this.silenceTimeout = window.setTimeout(() => {
      const elapsed = Date.now() - (this.lastSpeechTimestamp ?? Date.now())
      if (elapsed >= this.config.minSilenceDuration) {
        this.setSpeaking(false, 0)
      }
      if (this.silenceTimeout !== null) {
        window.clearTimeout(this.silenceTimeout)
        this.silenceTimeout = null
      }
    }, this.config.minSilenceDuration)
  }

  private estimateConfidence(transcript: SpeechTranscript): number {
    if (transcript.segments.length === 0) {
      return 0.5
    }

    const avg = transcript.segments.reduce((sum, seg) => sum + (seg.confidence ?? 0.85), 0) / transcript.segments.length
    return Math.min(0.99, Math.max(0.4, avg))
  }

  private setSpeaking(isSpeaking: boolean, confidence: number): void {
    if (isSpeaking === this.isSpeaking && this.probability === confidence) {
      return
    }

    const now = Date.now()
    const transitioned = isSpeaking !== this.isSpeaking

    this.isSpeaking = isSpeaking
    this.probability = confidence

    if (transitioned) {
      if (isSpeaking) {
        this.emit({ type: 'speech-start', timestamp: now, confidence })
      } else {
        this.emit({ type: 'speech-end', timestamp: now })
      }
    }
  }

  getState(): { isSpeaking: boolean; probability: number; lastSpeechTimestamp: number | null } {
    return {
      isSpeaking: this.isSpeaking,
      probability: this.probability,
      lastSpeechTimestamp: this.lastSpeechTimestamp,
    }
  }

  private emit(event: SpeechEngineEvent): void {
    const handlers = this.listeners.get(event.type)
    if (!handlers) return
    handlers.forEach((handler) => {
      try {
        ;(handler as any)(event)
      } catch (error) {
        console.error('[SpeechActivityPipeline] Listener error', error)
      }
    })
  }
}
