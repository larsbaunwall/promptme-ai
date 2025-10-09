/**
 * Audio Processing Utilities
 */

/**
 * Resample audio from one sample rate to another
 */
export function resampleAudio(
  samples: Float32Array,
  fromRate: number,
  toRate: number
): Float32Array {
  if (fromRate === toRate) {
    return samples
  }

  const ratio = fromRate / toRate
  const newLength = Math.round(samples.length / ratio)
  const result = new Float32Array(newLength)

  for (let i = 0; i < newLength; i++) {
    const srcIndex = i * ratio
    const srcIndexFloor = Math.floor(srcIndex)
    const srcIndexCeil = Math.min(srcIndexFloor + 1, samples.length - 1)
    const fraction = srcIndex - srcIndexFloor

    // Linear interpolation
    result[i] =
      samples[srcIndexFloor] * (1 - fraction) + samples[srcIndexCeil] * fraction
  }

  return result
}

/**
 * Convert stereo to mono by averaging channels
 */
export function stereoToMono(left: Float32Array, right: Float32Array): Float32Array {
  const length = Math.min(left.length, right.length)
  const mono = new Float32Array(length)

  for (let i = 0; i < length; i++) {
    mono[i] = (left[i] + right[i]) / 2
  }

  return mono
}

/**
 * Normalize audio samples to range [-1, 1]
 */
export function normalizeAudio(samples: Float32Array): Float32Array {
  let max = 0

  // Find max absolute value
  for (let i = 0; i < samples.length; i++) {
    const abs = Math.abs(samples[i])
    if (abs > max) {
      max = abs
    }
  }

  // Avoid division by zero
  if (max === 0) {
    return samples
  }

  // Normalize
  const normalized = new Float32Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    normalized[i] = samples[i] / max
  }

  return normalized
}

/**
 * Calculate RMS (Root Mean Square) energy of audio
 */
export function calculateRMS(samples: Float32Array): number {
  let sum = 0
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i]
  }
  return Math.sqrt(sum / samples.length)
}

/**
 * Apply pre-emphasis filter (boost high frequencies)
 * Useful for speech processing
 */
export function preEmphasis(samples: Float32Array, coefficient = 0.97): Float32Array {
  const result = new Float32Array(samples.length)
  result[0] = samples[0]

  for (let i = 1; i < samples.length; i++) {
    result[i] = samples[i] - coefficient * samples[i - 1]
  }

  return result
}

/**
 * Simple high-pass filter to remove DC offset
 */
export function removeDCOffset(samples: Float32Array): Float32Array {
  // Calculate mean
  let sum = 0
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i]
  }
  const mean = sum / samples.length

  // Subtract mean
  const result = new Float32Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    result[i] = samples[i] - mean
  }

  return result
}

/**
 * Convert Float32Array to Int16Array (PCM 16-bit)
 */
export function float32ToInt16(samples: Float32Array): Int16Array {
  const int16 = new Int16Array(samples.length)

  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }

  return int16
}

/**
 * Convert Int16Array to Float32Array
 */
export function int16ToFloat32(samples: Int16Array): Float32Array {
  const float32 = new Float32Array(samples.length)

  for (let i = 0; i < samples.length; i++) {
    float32[i] = samples[i] / (samples[i] < 0 ? 0x8000 : 0x7fff)
  }

  return float32
}

/**
 * Concatenate multiple audio buffers
 */
export function concatenateAudio(...buffers: Float32Array[]): Float32Array {
  const totalLength = buffers.reduce((sum, buf) => sum + buf.length, 0)
  const result = new Float32Array(totalLength)

  let offset = 0
  for (const buffer of buffers) {
    result.set(buffer, offset)
    offset += buffer.length
  }

  return result
}

/**
 * Split audio into fixed-size chunks
 */
export function* chunkAudio(
  samples: Float32Array,
  chunkSize: number
): Generator<Float32Array> {
  for (let i = 0; i < samples.length; i += chunkSize) {
    const end = Math.min(i + chunkSize, samples.length)
    yield samples.slice(i, end)
  }
}
