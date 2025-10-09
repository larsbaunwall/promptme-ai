/**
 * Pacing Composable
 * Manages auto-pacing of teleprompter scroll speed
 */

import { ref, reactive, computed, onUnmounted } from 'vue'
import { PacingController } from '@/services/pacing'
import type { PacingConfig, PacingUpdate } from '@/types/ai'

export function usePacing(initialConfig?: Partial<PacingConfig>) {
  const config = reactive<PacingConfig>({
    ...({ enabled: true, targetLead: 6, minLead: 3, maxLead: 10, minSpeed: 0.5, maxSpeed: 5, accelerationRate: 0.1, confidenceThreshold: 0.6 } as PacingConfig),
    ...initialConfig,
  })

  const isActive = ref(false)
  const lastUpdate = ref<PacingUpdate | null>(null)

  let controller: PacingController | null = null

  // Computed state
  const currentSpeed = computed(() => controller?.getState().currentSpeed ?? 2)
  const lead = computed(() => controller?.getState().lead ?? 0)
  const isAdjusting = computed(() => controller?.getState().isAdjusting ?? false)

  /**
   * Initialize pacing controller
   */
  const initialize = (): void => {
    controller = new PacingController(config)
    controller.initialize(config)
    isActive.value = true
    console.log('[usePacing] Initialized')
  }

  /**
   * Update pacing based on speaker and scroll positions
   */
  const update = (
    speakerPosition: number,
    scrollPosition: number,
    confidence: number
  ): PacingUpdate | null => {
    if (!controller || !isActive.value || !config.enabled) {
      return null
    }

    const result = controller.update(speakerPosition, scrollPosition, confidence)
    lastUpdate.value = result

    return result
  }

  /**
   * Manually set speed (disables auto-pacing temporarily)
   */
  const setManualSpeed = (speed: number): void => {
    if (controller) {
      controller.setManualSpeed(speed)
    }
  }

  /**
   * Reset pacing state
   */
  const reset = (): void => {
    if (controller) {
      controller.reset()
      lastUpdate.value = null
      console.log('[usePacing] State reset')
    }
  }

  /**
   * Enable/disable auto-pacing
   */
  const setEnabled = (enabled: boolean): void => {
    config.enabled = enabled
    console.log('[usePacing] Auto-pacing', enabled ? 'enabled' : 'disabled')
  }

  /**
   * Update configuration
   */
  const updateConfig = (newConfig: Partial<PacingConfig>): void => {
    Object.assign(config, newConfig)

    if (controller) {
      controller.initialize(config)
    }
  }

  /**
   * Destroy pacing controller
   */
  const destroy = (): void => {
    controller = null
    isActive.value = false
    lastUpdate.value = null
    console.log('[usePacing] Destroyed')
  }

  // Cleanup on unmount
  onUnmounted(() => {
    destroy()
  })

  return {
    // State
    config,
    isActive,
    currentSpeed,
    lead,
    isAdjusting,
    lastUpdate,

    // Methods
    initialize,
    update,
    setManualSpeed,
    setEnabled,
    reset,
    updateConfig,
    destroy,
  }
}
