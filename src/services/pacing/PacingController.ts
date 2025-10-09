/**
 * Pacing Controller
 * Automatically adjusts scroll speed based on speaker position
 */

import type {
  PacingConfig,
  PacingState,
  PacingUpdate,
  IPacingController,
} from '@/types/ai'

export class PacingController implements IPacingController {
  private config: PacingConfig
  private state: PacingState = {
    currentSpeed: 2,
    targetSpeed: 2,
    lead: 0,
    speakerPosition: 0,
    scrollPosition: 0,
    isAdjusting: false,
  }

  constructor(config: PacingConfig) {
    this.config = config
    this.state.currentSpeed = this.config.minSpeed +
      (this.config.maxSpeed - this.config.minSpeed) / 2
    this.state.targetSpeed = this.state.currentSpeed
  }

  initialize(config: PacingConfig): void {
    this.config = config
    console.log('[PacingController] Initialized')
  }

  update(
    speakerPosition: number,
    scrollPosition: number,
    confidence: number
  ): PacingUpdate {
    this.state.speakerPosition = speakerPosition
    this.state.scrollPosition = scrollPosition

    // Calculate lead (how many words ahead the scroll is)
    this.state.lead = scrollPosition - speakerPosition

    // Don't adjust if confidence is too low
    if (confidence < this.config.confidenceThreshold) {
      return {
        newSpeed: this.state.currentSpeed,
        reason: 'optimal',
        lead: this.state.lead,
        confidence,
      }
    }

    // Determine if we need to adjust speed
    let newSpeed = this.state.currentSpeed
    let reason: PacingUpdate['reason'] = 'optimal'

    if (this.state.lead < this.config.minLead) {
      // Too close - speed up
      newSpeed = Math.min(
        this.state.currentSpeed + this.config.accelerationRate,
        this.config.maxSpeed
      )
      reason = 'too-close'
      this.state.isAdjusting = true
    } else if (this.state.lead > this.config.maxLead) {
      // Too far - slow down
      newSpeed = Math.max(
        this.state.currentSpeed - this.config.accelerationRate,
        this.config.minSpeed
      )
      reason = 'too-far'
      this.state.isAdjusting = true
    } else {
      // In optimal range - maintain or gradually approach target
      const targetLead = this.config.targetLead
      if (this.state.lead < targetLead) {
        // Slightly accelerate toward target
        newSpeed = Math.min(
          this.state.currentSpeed + this.config.accelerationRate * 0.5,
          this.config.maxSpeed
        )
      } else if (this.state.lead > targetLead) {
        // Slightly decelerate toward target
        newSpeed = Math.max(
          this.state.currentSpeed - this.config.accelerationRate * 0.5,
          this.config.minSpeed
        )
      }
      this.state.isAdjusting = false
    }

    this.state.currentSpeed = newSpeed
    this.state.targetSpeed = newSpeed

    return {
      newSpeed,
      reason,
      lead: this.state.lead,
      confidence,
    }
  }

  setManualSpeed(speed: number): void {
    // Clamp to min/max
    this.state.currentSpeed = Math.max(
      this.config.minSpeed,
      Math.min(speed, this.config.maxSpeed)
    )
    this.state.targetSpeed = this.state.currentSpeed
    console.log('[PacingController] Manual speed set:', this.state.currentSpeed)
  }

  reset(): void {
    this.state = {
      currentSpeed: this.config.minSpeed +
        (this.config.maxSpeed - this.config.minSpeed) / 2,
      targetSpeed: this.config.minSpeed +
        (this.config.maxSpeed - this.config.minSpeed) / 2,
      lead: 0,
      speakerPosition: 0,
      scrollPosition: 0,
      isAdjusting: false,
    }
    console.log('[PacingController] State reset')
  }

  getState(): PacingState {
    return { ...this.state }
  }
}
