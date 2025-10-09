/**
 * Auto-pacing type definitions
 */

export interface PacingConfig {
  enabled: boolean
  targetLead: number // Words ahead of speaker (target)
  minLead: number // Minimum words ahead
  maxLead: number // Maximum words ahead
  minSpeed: number // Minimum scroll speed
  maxSpeed: number // Maximum scroll speed
  accelerationRate: number // Speed change per update
  confidenceThreshold: number // Only adjust on confident alignment
}

export interface PacingState {
  currentSpeed: number
  targetSpeed: number
  lead: number // Current words ahead
  speakerPosition: number // Word index where speaker is
  scrollPosition: number // Word index at top of screen
  isAdjusting: boolean
}

export interface PacingUpdate {
  newSpeed: number
  reason: 'too-close' | 'too-far' | 'optimal' | 'manual'
  lead: number
  confidence: number
}

export const DEFAULT_PACING_CONFIG: PacingConfig = {
  enabled: true,
  targetLead: 6,
  minLead: 3,
  maxLead: 10,
  minSpeed: 0.5,
  maxSpeed: 5,
  accelerationRate: 0.1,
  confidenceThreshold: 0.6,
}

export interface IPacingController {
  initialize(config: PacingConfig): void
  update(speakerPosition: number, scrollPosition: number, confidence: number): PacingUpdate
  setManualSpeed(speed: number): void
  reset(): void
  getState(): PacingState
}
