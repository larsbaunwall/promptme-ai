/**
 * Whisper-web speech service wrapper
 * Handles worker lifecycle and streaming transcription
 */

import type {
  SpeechBackend,
  SpeechConfig,
  SpeechProgress,
  SpeechTranscript,
} from '@/types/ai'

interface WorkerConfigPayload {
  model: string
  multilingual: boolean
  quantized: boolean
  subtask: 'transcribe' | 'translate'
  language: string | null
}

interface WorkerRequest {
  id: number
  audio: Float32Array
  config: WorkerConfigPayload
}

interface WorkerResponseBase {
  id: number
  status:
    | 'progress'
    | 'download'
    | 'update'
    | 'complete'
    | 'initiate'
    | 'done'
    | 'ready'
    | 'error'
  data?: any
  file?: string
  progress?: number
  loaded?: number
  total?: number
  name?: string
}

type WorkerResponse = WorkerResponseBase & {
  elapsed_ms?: number
}

interface PendingRequest {
  resolve: (value: SpeechTranscript) => void
  reject: (reason?: Error) => void
  onUpdate?: (transcript: SpeechTranscript) => void
  onProgress?: (progress: SpeechProgress) => void
  startedAt: number
}

export class WhisperWebService {
  private worker: Worker | null = null
  private config: SpeechConfig | null = null
  private backend: SpeechBackend = 'wasm'
  private requestId = 0
  private pending = new Map<number, PendingRequest>()
  private initialized = false
  private loading = false
  private lastInferenceMs = 0

  async initialize(config: SpeechConfig): Promise<SpeechBackend> {
    this.config = config

    if (!this.worker) {
      this.worker = new Worker(new URL('../../workers/whisper-web-worker.ts', import.meta.url), {
        type: 'module',
      })
      this.worker.addEventListener('message', this.handleWorkerMessage)
      this.worker.addEventListener('error', (event) => {
        console.error('[WhisperWebService] Worker error', event)
      })
    }

    if (!this.initialized) {
      this.initialized = true

      // Estimate backend
      if (typeof navigator !== 'undefined' && 'gpu' in navigator) {
        try {
          const adapter = await (navigator as any).gpu?.requestAdapter()
          if (adapter) {
            this.backend = 'webgpu'
          }
        } catch {
          this.backend = 'wasm'
        }
      }

      // Optional warmup (send short silence)
      if (config.warmup) {
        const sampleRate = 16000
        const warmupSamples = Math.max(1, Math.floor((config.chunkDuration / 1000) * sampleRate))
        const silentBuffer = new Float32Array(warmupSamples)
        try {
          await this.transcribe(silentBuffer, {
            onUpdate: () => {},
            onProgress: () => {},
          })
        } catch (error) {
          console.warn('[WhisperWebService] Warmup failed (expected on some browsers):', error)
          this.config.warmup = false
        }
      }
    }

    return this.backend
  }

  getBackend(): SpeechBackend {
    return this.backend
  }

  getLastInferenceMs(): number {
    return this.lastInferenceMs
  }

  isInitialized(): boolean {
    return this.initialized
  }

  isLoading(): boolean {
    return this.loading
  }

  async transcribe(
    audio: Float32Array,
    handlers: {
      onUpdate?: (transcript: SpeechTranscript) => void
      onProgress?: (progress: SpeechProgress) => void
    } = {}
  ): Promise<SpeechTranscript> {
    if (!this.worker || !this.config) {
      throw new Error('WhisperWebService not initialized')
    }

    const id = ++this.requestId
    const startedAt = performance.now()

    const promise = new Promise<SpeechTranscript>((resolve, reject) => {
      this.pending.set(id, {
        resolve,
        reject,
        onUpdate: handlers.onUpdate,
        onProgress: handlers.onProgress,
        startedAt,
      })
    })

    const payload: WorkerRequest = {
      id,
      audio,
      config: this.serializeConfig(),
    }

    try {
      this.worker.postMessage(payload, [audio.buffer])
    } catch (error) {
      this.pending.delete(id)
      throw error
    }

    return promise
  }

  private serializeConfig(): WorkerConfigPayload {
    if (!this.config) {
      throw new Error('Speech config not initialized')
    }

    const {
      model,
      multilingual,
      quantized,
      subtask,
      language,
    } = this.config

    return {
      model,
      multilingual,
      quantized,
      subtask,
      language,
    }
  }

  destroy(): void {
    if (this.worker) {
      this.worker.terminate()
      this.worker = null
    }
    this.pending.clear()
    this.initialized = false
    this.loading = false
  }

  private handleWorkerMessage = (event: MessageEvent<WorkerResponse>): void => {
    const message = event.data
    const pending = this.pending.get(message.id)

    switch (message.status) {
      case 'initiate':
        this.loading = true
        pending?.onProgress?.({
          file: message.file ?? 'model',
          progress: 0,
          loaded: message.loaded ?? 0,
          total: message.total ?? 0,
          status: message.status,
          name: message.name,
        })
        break
      case 'download':
      case 'progress':
        pending?.onProgress?.({
          file: message.file ?? 'model',
          progress: message.progress ?? 0,
          loaded: message.loaded ?? 0,
          total: message.total ?? 0,
          status: message.status,
          name: message.name,
        })
        break
      case 'done':
        pending?.onProgress?.({
          file: message.file ?? 'model',
          progress: 1,
          loaded: message.loaded ?? 0,
          total: message.total ?? 0,
          status: message.status,
          name: message.name,
        })
        break
      case 'ready':
        this.loading = false
        break
      case 'update': {
        const transcript = this.convertToTranscript(message.data, false)
        pending?.onUpdate?.(transcript)
        break
      }
      case 'complete': {
        this.pending.delete(message.id)
        const transcript = this.convertToTranscript(message.data, true)
        const elapsed = performance.now() - (pending?.startedAt ?? performance.now())
        this.lastInferenceMs = elapsed
        pending?.resolve(transcript)
        break
      }
      case 'error':
        {
          this.pending.delete(message.id)
          const error =
            message.data instanceof Error
              ? message.data
              : new Error(
                  typeof message.data === 'string'
                    ? message.data
                    : message?.data?.message ?? 'Unknown whisper-web error'
                )
          pending?.reject(error)
        }
        break
      default:
        console.warn('[WhisperWebService] Unhandled worker status', message.status)
        break
    }
  }

  private convertToTranscript(raw: any, isFinal: boolean): SpeechTranscript {
    const receivedAt = Date.now()

    if (!raw) {
      return {
        text: '',
        segments: [],
        isFinal,
        receivedAt,
      }
    }

    if (Array.isArray(raw)) {
      const [text, meta] = raw as [string, { chunks: any[] }]
      return {
        text,
        segments: this.convertChunks(meta?.chunks ?? []),
        isFinal,
        receivedAt,
      }
    }

    if (raw.text && raw.chunks) {
      return {
        text: raw.text,
        segments: this.convertChunks(raw.chunks),
        isFinal,
        receivedAt,
      }
    }

    if (typeof raw === 'string') {
      return {
        text: raw,
        segments: [],
        isFinal,
        receivedAt,
      }
    }

    return {
      text: '',
      segments: [],
      isFinal,
      receivedAt,
    }
  }

  private convertChunks(chunks: any[]): SpeechTranscript['segments'] {
    return chunks
      .filter((chunk) => typeof chunk?.text === 'string')
      .map((chunk) => {
        const text: string = chunk.text.trim()
        const [start, endMaybe] = Array.isArray(chunk.timestamp) ? chunk.timestamp : [0, null]
        const sanitizedStart = typeof start === 'number' ? start : 0
        let sanitizedEnd =
          typeof endMaybe === 'number' && !Number.isNaN(endMaybe)
            ? endMaybe
            : sanitizedStart + Math.max(text.split(/\s+/).length * 0.18, 0.35)

        if (sanitizedEnd < sanitizedStart) {
          sanitizedEnd = sanitizedStart
        }

        const words = text.split(/\s+/).filter(Boolean)
        const duration = sanitizedEnd - sanitizedStart
        const step = words.length > 0 ? duration / words.length : 0

        return {
          text,
          start: sanitizedStart,
          end: sanitizedEnd,
          confidence: 0.85,
          words: words.map((word, index) => {
            const wordStart = sanitizedStart + index * step
            const wordEnd = index === words.length - 1 ? sanitizedEnd : wordStart + step
            return {
              word,
              start: wordStart,
              end: wordEnd,
              confidence: 0.85,
            }
          }),
        }
      })
  }
}
