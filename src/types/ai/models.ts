/**
 * Model management type definitions
 */

export interface ModelInfo {
  name: string
  version: string
  size: number // bytes
  url: string
  hash?: string
  description: string
  languages?: string[]
}

export interface ModelLoadProgress {
  modelName: string
  stage: 'downloading' | 'caching' | 'initializing' | 'ready' | 'error'
  progress: number // 0-100
  bytesLoaded?: number
  bytesTotal?: number
  error?: string
}

export interface ModelCacheEntry {
  modelName: string
  version: string
  timestamp: number
  size: number
  data: ArrayBuffer
}

export interface BrowserCapabilities {
  webGPU: boolean
  wasm: boolean
  audioWorklet: boolean
  audioContext: boolean
  indexedDB: boolean
  mediaDevices: boolean
}

export const AVAILABLE_MODELS = {
  'Xenova/whisper-tiny': {
    name: 'Xenova/whisper-tiny',
    version: '1.0',
    size: 200 * 1024 * 1024, // ~200MB including tokenizer and wasm assets
    url: 'https://huggingface.co/Xenova/whisper-tiny',
    description: 'Xenova whisper tiny model packaged for browser use',
    languages: ['en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'pl', 'ru', 'ja', 'ko', 'zh'],
  },
} as const

export type ModelName = keyof typeof AVAILABLE_MODELS

export interface IModelLoader {
  load(modelName: ModelName, onProgress?: (progress: ModelLoadProgress) => void): Promise<any>
  isModelCached(modelName: ModelName): Promise<boolean>
  clearCache(modelName?: ModelName): Promise<void>
  getCacheSize(): Promise<number>
}

export interface IModelCache {
  get(modelName: string): Promise<ModelCacheEntry | null>
  set(modelName: string, data: ArrayBuffer, version: string): Promise<void>
  delete(modelName: string): Promise<void>
  clear(): Promise<void>
  getSize(): Promise<number>
}
