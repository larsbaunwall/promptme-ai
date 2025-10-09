/**
 * Speech engine type definitions (whisper-web only)
 */

export type SpeechBackend = 'webgpu' | 'wasm'

export interface SpeechConfig {
  engine: 'whisper-web'
  language: string | null
  chunkDuration: number // in milliseconds
  speechProbabilityThreshold: number // 0-1 (derived from updates)
  minSpeechDuration: number // ms
  minSilenceDuration: number // ms
  warmup: boolean
  quantized: boolean
  multilingual: boolean
  subtask: 'transcribe' | 'translate'
  model: 'Xenova/whisper-tiny' | 'Xenova/whisper-base' | string
}

export interface SpeechWordTimestamp {
  word: string
  start: number // seconds
  end: number // seconds
  confidence: number // 0-1
}

export interface SpeechSegment {
  text: string
  words: SpeechWordTimestamp[]
  start: number
  end: number
  confidence: number
}

export interface SpeechTranscript {
  text: string
  segments: SpeechSegment[]
  isFinal: boolean
  receivedAt: number
}

export interface SpeechActivityState {
  isSpeaking: boolean
  probability: number
  lastSpeechTimestamp: number | null
  backend: SpeechBackend
}

export interface SpeechProgress {
  file: string
  progress: number
  loaded: number
  total: number
  status: string
  name?: string
}

export type SpeechEngineEvent =
  | { type: 'speech-start'; timestamp: number; confidence: number }
  | { type: 'speech-end'; timestamp: number }
  | { type: 'transcript'; transcript: SpeechTranscript }
  | { type: 'progress'; progress: SpeechProgress }
  | { type: 'inference-start' }
  | { type: 'inference-complete'; elapsedMs: number }
  | { type: 'ready' }
  | { type: 'error'; error: Error }

export interface SpeechEngineStats {
  lastInferenceMs: number
  backend: SpeechBackend
}

export interface SpeechEngineState {
  initialized: boolean
  loading: boolean
  backend: SpeechBackend
  error: string | null
  lastInferenceMs: number
}

export const DEFAULT_SPEECH_CONFIG: SpeechConfig = {
  engine: 'whisper-web',
  language: null,
  chunkDuration: 4000,
  speechProbabilityThreshold: 0.55,
  minSpeechDuration: 250,
  minSilenceDuration: 400,
  warmup: false,
  quantized: true,
  multilingual: false,
  subtask: 'transcribe',
  model: 'Xenova/whisper-tiny',
}
