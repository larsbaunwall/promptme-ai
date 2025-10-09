<template>
  <div id="app">
    <div class="controls-wrapper">
      <TeleprompterControls
        :is-playing="isPlaying"
        :speed="aiEnabled ? aiSpeed : speed"
        :font-size="fontSize"
        :mirror-vertical="mirrorVertical"
        :mirror-horizontal="mirrorHorizontal"
        @play-toggle="handlePlayToggle"
        @speed-change="handleSpeedChange"
        @font-size-change="updateFontSize"
        @mirror-vertical-toggle="toggleMirrorVertical"
        @mirror-horizontal-toggle="toggleMirrorHorizontal"
      />

      <AIControls
        :is-active="aiEnabled"
        :is-loading="aiLoading"
        :error="aiError"
        @toggle="toggleAI"
      />
    </div>

    <SpeechIndicator
      v-if="aiEnabled"
      :is-speaking="isSpeaking"
      :current-position="currentWordIndex"
      :total-words="totalWords"
      :confidence="aiConfidence"
      :alignment-status="alignmentStatus"
      :lead="lead"
      :recognized-text="recognizedText"
    />

    <TeleprompterDisplay
      :text="text"
      :font-size="fontSize"
      :is-playing="isPlaying"
      :transform="transform"
      :formatted-text="formattedText"
      :current-word-index="aiEnabled ? currentWordIndex : -1"
      @text-change="handleTextChange"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import TeleprompterControls from '@/components/TeleprompterControls.vue'
import TeleprompterDisplay from '@/components/TeleprompterDisplay.vue'
import AIControls from '@/components/ai/AIControls.vue'
import SpeechIndicator from '@/components/ai/SpeechIndicator.vue'
import { useTeleprompter } from '@/composables/useTeleprompter'
import { useSpeechTracking } from '@/composables/ai/useSpeechTracking'

const {
  text,
  fontSize,
  speed,
  isPlaying,
  scrollPosition,
  mirrorVertical,
  mirrorHorizontal,
  transform,
  formattedText,
  togglePlay,
  updateSpeed,
  updateFontSize,
  toggleMirrorVertical,
  toggleMirrorHorizontal,
  setText,
  startPlayback,
  stopPlayback
} = useTeleprompter()

// AI state
const aiEnabled = ref(false)
const aiLoading = ref(false)
const localError = ref<string | null>(null)
const speechTracking = useSpeechTracking()

// AI computed values
const isSpeaking = computed(() => speechTracking.isSpeaking.value)
const currentWordIndex = computed(() => speechTracking.currentWordIndex.value)
const aiConfidence = computed(() => speechTracking.alignment.confidence.value ?? 0)
const alignmentStatus = computed(() => speechTracking.alignment.status.value ?? 'lost')
const lead = computed(() => speechTracking.pacing.lead.value ?? 0)
const aiSpeed = computed(() => speechTracking.pacing.currentSpeed.value ?? speed.value)
const aiError = computed(() => localError.value || speechTracking.error.value || null)
const totalWords = computed(() => speechTracking.alignment.state.value?.totalWords ?? 0)
const recognizedText = computed(() => speechTracking.speech.lastTranscript.value?.text ?? '')

// Auto-pause when speech stops (per original plan requirements)
watch(isSpeaking, (speaking) => {
  if (aiEnabled.value) {
    if (speaking && !isPlaying.value) {
      // Resume playback when speaking
      console.log('[App] Auto-resuming playback (speech detected)')
      startPlayback(false)
    } else if (!speaking && isPlaying.value) {
      // Pause playback when speech stops
      console.log('[App] Auto-pausing playback (speech stopped)')
      stopPlayback()
    }
  }
})

// Update AI system with scroll position
watch(scrollPosition, (newScrollPos) => {
  if (aiEnabled.value) {
    const words = text.value.split(/\s+/).filter(w => w.length > 0)
    speechTracking.updateScrollPosition(newScrollPos, fontSize.value, words.length)
  }
})

// Toggle AI
const toggleAI = async () => {
  if (aiEnabled.value) {
    // Disable AI
    speechTracking.stop()
    speechTracking.destroy()
    aiEnabled.value = false
    localError.value = null

    // Auto-start manual scrolling
    if (!isPlaying.value) {
      startPlayback(false)
    }
  } else {
    // Enable AI
    try {
      aiLoading.value = true
      localError.value = null

      // Ensure teleprompter is paused when enabling AI
      if (isPlaying.value) {
        stopPlayback()
      }
      scrollPosition.value = 0

      speechTracking.setTranscript(text.value)
      await speechTracking.initialize(text.value)
      await speechTracking.start() // Start listening for speech
      aiEnabled.value = true

      console.log('[App] AI enabled - teleprompter will scroll when you start speaking')
    } catch (error) {
      console.error('Failed to initialize AI:', error)
      localError.value = error instanceof Error ? error.message : 'Failed to start AI'
    } finally {
      aiLoading.value = false
    }
  }
}

// Handle play toggle - block manual play in AI mode
const handlePlayToggle = () => {
  if (aiEnabled.value) {
    console.log('[App] Manual play blocked - AI controls playback in full-auto mode')
    // In AI mode, playback is controlled by speech detection
    // User shouldn't manually start/stop
    return
  }
  // Normal mode: allow manual toggle
  togglePlay()
}

// Handle speed change
const handleSpeedChange = (newSpeed: number) => {
  if (aiEnabled.value) {
    console.log('[App] Speed control disabled while AI is active')
    return
  }
  updateSpeed(newSpeed)
}

// Handle text change
const handleTextChange = (newText: string) => {
  setText(newText)
  speechTracking.setTranscript(newText)

  // Reinitialize alignment if AI is active
  if (aiEnabled.value) {
    speechTracking.reset()
    speechTracking.alignment.initialize(newText)
  }
}

// Watch for AI speed changes in full-auto mode
watch(aiSpeed, (newSpeed) => {
  if (aiEnabled.value) {
    updateSpeed(newSpeed)
  }
})

// Set initial text
onMounted(() => {
  setText(`Welcome to PromptMe AI!

This is your AI-powered teleprompter.

You can:
• Type or paste your script
• Use [square brackets] for emphasis
• Enable AI mode for automatic tracking
• Adjust font size and scroll speed
• Mirror vertically or horizontally

Try enabling AI mode and start speaking your script!`)
})
</script>

<style>
@import '@/assets/styles/global.css';

.controls-wrapper {
  display: flex;
  gap: 15px;
  align-items: center;
  flex-wrap: wrap;
}
</style>
