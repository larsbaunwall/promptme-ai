<template>
  <div class="speech-indicator" :class="{ active: isSpeaking, hidden: !show }">
    <div class="indicator-content">
      <div class="mic-icon" :class="{ pulsing: isSpeaking }">
        {{ isSpeaking ? '🎤' : '🔇' }}
      </div>

      <div class="info">
        <div class="status-line">
          <span class="label">Status:</span>
          <span class="value" :class="`status-${alignmentStatus}`">
            {{ statusText }}
          </span>
        </div>

        <div v-if="showPosition" class="status-line">
          <span class="label">Position:</span>
          <span class="value">Word {{ currentPosition }} of {{ totalWords }}</span>
        </div>

        <div v-if="showConfidence" class="status-line">
          <span class="label">Confidence:</span>
          <span class="value">
            <span class="confidence-bar">
              <span
                class="confidence-fill"
                :style="{ width: `${confidence * 100}%` }"
                :class="confidenceClass"
              ></span>
            </span>
            {{ Math.round(confidence * 100) }}%
          </span>
        </div>

        <div v-if="showLead" class="status-line">
          <span class="label">Lead:</span>
          <span class="value">{{ lead }} words {{ leadStatus }}</span>
        </div>

        <div v-if="props.recognizedText" class="recognized-text">
          “{{ props.recognizedText }}”
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

interface Props {
  show?: boolean
  isSpeaking: boolean
  currentPosition?: number
  totalWords?: number
  confidence?: number
  alignmentStatus?: 'good' | 'uncertain' | 'lost'
  lead?: number
  targetLead?: number
  showPosition?: boolean
  showConfidence?: boolean
  showLead?: boolean
  recognizedText?: string
}

const props = withDefaults(defineProps<Props>(), {
  show: true,
  currentPosition: 0,
  totalWords: 0,
  confidence: 0,
  alignmentStatus: 'lost',
  lead: 0,
  targetLead: 6,
  showPosition: true,
  showConfidence: true,
  showLead: true,
  recognizedText: '',
})

const statusText = computed(() => {
  if (!props.isSpeaking) return 'Waiting...'

  switch (props.alignmentStatus) {
    case 'good':
      return 'Tracking ✓'
    case 'uncertain':
      return 'Uncertain'
    case 'lost':
      return 'Lost'
    default:
      return 'Unknown'
  }
})

const confidenceClass = computed(() => {
  if (props.confidence >= 0.8) return 'high'
  if (props.confidence >= 0.6) return 'medium'
  return 'low'
})

const leadStatus = computed(() => {
  const diff = props.lead - props.targetLead
  if (Math.abs(diff) <= 2) return '✓'
  if (diff < 0) return '⚠️'
  return '➔'
})
</script>

<style scoped>
.speech-indicator {
  position: fixed;
  top: 80px;
  right: 20px;
  background: rgba(26, 26, 26, 0.95);
  border: 2px solid #333;
  border-radius: 8px;
  padding: 12px;
  min-width: 250px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
  transition: all 0.3s;
  z-index: 1000;
}

.speech-indicator.hidden {
  opacity: 0;
  pointer-events: none;
}

.speech-indicator.active {
  border-color: #0066cc;
}

.indicator-content {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}

.mic-icon {
  font-size: 28px;
  transition: transform 0.2s;
}

.mic-icon.pulsing {
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(1.1);
    opacity: 0.8;
  }
}

.info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.status-line {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
}

.label {
  color: #aaa;
  font-weight: 500;
}

.value {
  color: #fff;
  font-weight: 600;
}

.recognized-text {
  color: #bbb;
  font-size: 12px;
  font-style: italic;
  line-height: 1.4;
  margin-top: 2px;
}

.status-good {
  color: #4caf50;
}

.status-uncertain {
  color: #ff9800;
}

.status-lost {
  color: #f44336;
}

.confidence-bar {
  display: inline-block;
  width: 60px;
  height: 8px;
  background: #333;
  border-radius: 4px;
  overflow: hidden;
  vertical-align: middle;
  margin-right: 6px;
}

.confidence-fill {
  display: block;
  height: 100%;
  transition: width 0.3s, background 0.3s;
  border-radius: 4px;
}

.confidence-fill.high {
  background: #4caf50;
}

.confidence-fill.medium {
  background: #ff9800;
}

.confidence-fill.low {
  background: #f44336;
}
</style>
