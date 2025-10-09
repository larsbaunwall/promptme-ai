/**
 * Overall AI state type definitions
 */

import type { AlignmentConfig, AlignmentState } from './alignment'
import type { PacingConfig, PacingState } from './pacing'
import type { AudioConfig, AudioStreamState, MicrophonePermission } from './audio'
import type { BrowserCapabilities, ModelLoadProgress } from './models'
import type { SpeechConfig, SpeechEngineState } from './speech'

export interface AIConfig {
  audio: AudioConfig
  speech: SpeechConfig
  alignment: AlignmentConfig
  pacing: PacingConfig
}

export interface AIState {
  // Initialization
  initialized: boolean
  loading: boolean
  loadingProgress: ModelLoadProgress[]
  error: string | null

  // Configuration
  config: AIConfig

  // Capabilities
  capabilities: BrowserCapabilities
  microphonePermission: MicrophonePermission

  // Component states
  audio: AudioStreamState
  speech: SpeechEngineState
  alignment: AlignmentState
  pacing: PacingState

  // Runtime
  isListening: boolean
  isSpeaking: boolean
  currentWord: string | null
  currentWordIndex: number

  // Performance metrics
  performance: {
    speechLatency: number
    alignmentLatency: number
    totalLatency: number
    fps: number
  }
}

export interface AIEvent {
  type: AIEventType
  timestamp: number
  data?: any
}

export type AIEventType =
  | 'initialized'
  | 'error'
  | 'audio-start'
  | 'audio-stop'
  | 'speech-start'
  | 'speech-end'
  | 'transcription'
  | 'position-update'
  | 'speed-change'
  | 'model-load-start'
  | 'model-load-progress'
  | 'model-load-complete'
  | 'model-load-error'

export interface AIError {
  code: AIErrorCode
  message: string
  details?: any
  timestamp: number
}

export enum AIErrorCode {
  MICROPHONE_PERMISSION_DENIED = 'MICROPHONE_PERMISSION_DENIED',
  MICROPHONE_NOT_AVAILABLE = 'MICROPHONE_NOT_AVAILABLE',
  AUDIO_CONTEXT_FAILED = 'AUDIO_CONTEXT_FAILED',
  MODEL_LOAD_FAILED = 'MODEL_LOAD_FAILED',
  MODEL_INFERENCE_FAILED = 'MODEL_INFERENCE_FAILED',
  WEBGPU_NOT_AVAILABLE = 'WEBGPU_NOT_AVAILABLE',
  WASM_NOT_AVAILABLE = 'WASM_NOT_AVAILABLE',
  INSUFFICIENT_PERFORMANCE = 'INSUFFICIENT_PERFORMANCE',
  NETWORK_ERROR = 'NETWORK_ERROR',
  BROWSER_NOT_SUPPORTED = 'BROWSER_NOT_SUPPORTED',
  INDEXEDDB_ERROR = 'INDEXEDDB_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}
