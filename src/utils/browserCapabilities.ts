/**
 * Browser capability detection utilities
 */

import type { BrowserCapabilities } from '@/types/ai'

/**
 * Detect WebGPU support
 */
export async function detectWebGPU(): Promise<boolean> {
  if (!('gpu' in navigator)) {
    return false
  }

  try {
    const adapter = await (navigator as any).gpu?.requestAdapter()
    return !!adapter
  } catch {
    return false
  }
}

/**
 * Detect WebAssembly support
 */
export function detectWASM(): boolean {
  try {
    if (typeof WebAssembly === 'object'
      && typeof WebAssembly.instantiate === 'function') {
      const module = new WebAssembly.Module(
        Uint8Array.of(0x0, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00)
      )
      if (module instanceof WebAssembly.Module) {
        return new WebAssembly.Instance(module) instanceof WebAssembly.Instance
      }
    }
  } catch {
    return false
  }
  return false
}

/**
 * Detect AudioWorklet support
 */
export function detectAudioWorklet(): boolean {
  return typeof AudioWorklet !== 'undefined'
}

/**
 * Detect IndexedDB support
 */
export function detectIndexedDB(): boolean {
  return typeof indexedDB !== 'undefined'
}

/**
 * Detect MediaDevices API support
 */
export function detectMediaDevices(): boolean {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)
}

/**
 * Detect AudioContext support
 */
export function detectAudioContext(): boolean {
  return !!(
    typeof AudioContext !== 'undefined' ||
    typeof (window as any).webkitAudioContext !== 'undefined'
  )
}

/**
 * Get all browser capabilities
 */
export async function getBrowserCapabilities(): Promise<BrowserCapabilities> {
  const [webGPU] = await Promise.all([
    detectWebGPU(),
  ])

  return {
    webGPU,
    wasm: detectWASM(),
    audioWorklet: detectAudioWorklet(),
    indexedDB: detectIndexedDB(),
    mediaDevices: detectMediaDevices(),
    audioContext: detectAudioContext(),
  }
}

/**
 * Check if browser meets minimum requirements
 */
export async function checkMinimumRequirements(): Promise<{
  met: boolean
  missing: string[]
}> {
  const capabilities = await getBrowserCapabilities()
  const missing: string[] = []

  if (!capabilities.wasm) {
    missing.push('WebAssembly')
  }
  if (!capabilities.audioContext) {
    missing.push('AudioContext')
  }
  if (!capabilities.mediaDevices) {
    missing.push('MediaDevices API')
  }
  if (!capabilities.indexedDB) {
    missing.push('IndexedDB')
  }

  return {
    met: missing.length === 0,
    missing,
  }
}

/**
 * Get recommended whisper-web backend based on capabilities
 */
export async function getRecommendedBackend(): Promise<'webgpu' | 'wasm'> {
  const hasWebGPU = await detectWebGPU()
  return hasWebGPU ? 'webgpu' : 'wasm'
}

/**
 * Estimate device performance tier
 */
export function estimatePerformanceTier(): 'low' | 'medium' | 'high' {
  // Check CPU cores
  const cores = navigator.hardwareConcurrency || 2

  // Check memory (if available)
  const memory = (navigator as any).deviceMemory || 4

  // Estimate based on available info
  if (cores >= 8 && memory >= 8) {
    return 'high'
  } else if (cores >= 4 && memory >= 4) {
    return 'medium'
  } else {
    return 'low'
  }
}

/**
 * Whisper-web ships a single supported model
 */
export function getRecommendedModel(): string {
  return 'Xenova/whisper-tiny'
}
