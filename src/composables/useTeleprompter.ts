import { ref, computed, onUnmounted } from 'vue'

export function useTeleprompter() {
  // State
  const text = ref('')
  const fontSize = ref(32)
  const speed = ref(2)
  const isPlaying = ref(false)
  const scrollPosition = ref(0)
  const mirrorVertical = ref(false)
  const mirrorHorizontal = ref(false)

  let animationFrame: number | null = null
  let lastTime: number | null = null

  // Computed transform based on mirror settings
  const transform = computed(() => {
    const transforms: string[] = []

    // Add translation first
    transforms.push(`translateY(${scrollPosition.value}px)`)

    // Add scale transforms
    if (mirrorVertical.value && mirrorHorizontal.value) {
      transforms.push('scale(-1, -1)')
    } else if (mirrorVertical.value) {
      transforms.push('scaleY(-1)')
    } else if (mirrorHorizontal.value) {
      transforms.push('scaleX(-1)')
    }

    return transforms.join(' ')
  })

  // Format text with emphasis
  const formatText = (rawText: string): string => {
    return rawText.replace(/\[([^\]]+)\]/g, '<span class="emphasis">$1</span>')
  }

  const formattedText = computed(() => formatText(text.value))

  // Animation loop
  const animate = (timestamp: number) => {
    if (!lastTime) lastTime = timestamp
    const delta = timestamp - lastTime
    lastTime = timestamp

    // Reduced scroll speed by 4x (multiply by 0.25)
    scrollPosition.value -= (speed.value * delta) / 16.67 * 0.25

    animationFrame = requestAnimationFrame(animate)
  }

  const startPlayback = (resetPosition = true) => {
    if (isPlaying.value) return
    if (resetPosition) {
      scrollPosition.value = 0
    }
    lastTime = null
    animationFrame = requestAnimationFrame(animate)
    isPlaying.value = true
  }

  const stopPlayback = () => {
    if (!isPlaying.value) return
    if (animationFrame) {
      cancelAnimationFrame(animationFrame)
      animationFrame = null
    }
    isPlaying.value = false
  }

  // Toggle play/pause
  const togglePlay = () => {
    if (isPlaying.value) {
      stopPlayback()
    } else {
      startPlayback(true)
    }
  }

  // Update controls
  const updateSpeed = (newSpeed: number) => {
    speed.value = newSpeed
  }

  const updateFontSize = (size: number) => {
    fontSize.value = size
  }

  const toggleMirrorVertical = () => {
    mirrorVertical.value = !mirrorVertical.value
  }

  const toggleMirrorHorizontal = () => {
    mirrorHorizontal.value = !mirrorHorizontal.value
  }

  const setText = (newText: string) => {
    text.value = newText
  }

  // Cleanup on unmount
  onUnmounted(() => {
    if (animationFrame) {
      cancelAnimationFrame(animationFrame)
    }
  })

  return {
    // State (refs)
    text,
    fontSize,
    speed,
    isPlaying,
    scrollPosition,
    mirrorVertical,
    mirrorHorizontal,
    // Computed
    transform,
    formattedText,
    // Methods
    togglePlay,
    startPlayback,
    stopPlayback,
    updateSpeed,
    updateFontSize,
    toggleMirrorVertical,
    toggleMirrorHorizontal,
    setText
  }
}
