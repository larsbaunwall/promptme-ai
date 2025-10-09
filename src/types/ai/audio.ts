/**
 * Audio-related type definitions
 */

export interface AudioConfig {
  sampleRate: number
  channels: number
  bufferSize: number
  echoCancellation?: boolean
  noiseSuppression?: boolean
  autoGainControl?: boolean
}

export interface AudioChunk {
  data: Float32Array
  timestamp: number
  duration: number
}

export interface AudioStreamState {
  isActive: boolean
  stream: MediaStream | null
  context: AudioContext | null
  error: string | null
}

export interface MicrophonePermission {
  state: 'granted' | 'denied' | 'prompt' | 'unknown'
  error?: string
}

export const DEFAULT_AUDIO_CONFIG: AudioConfig = {
  sampleRate: 16000,
  channels: 1,
  bufferSize: 4096,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
}
