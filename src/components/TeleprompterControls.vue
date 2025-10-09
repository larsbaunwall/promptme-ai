<template>
  <div class="controls">
    <div class="control-group">
      <button @click="onPlayClick">
        {{ isPlaying ? '⏸ Pause' : '▶ Play' }}
      </button>
    </div>

    <div class="control-group">
      <label>Speed:</label>
      <input
        type="range"
        :value="speed"
        @input="onSpeedChange"
        min="1"
        max="10"
        step="0.5"
      >
      <span class="speed-value">{{ speed }}</span>
    </div>

    <div class="control-group">
      <label>Font Size:</label>
      <input
        type="number"
        :value="fontSize"
        @input="onFontSizeChange"
        min="16"
        max="120"
        step="2"
      >
      <span style="color: #aaa;">px</span>
    </div>

    <div class="control-group">
      <button
        @click="onMirrorVerticalClick"
        class="toggle"
        :class="{ active: mirrorVertical }"
      >
        ↕ Vertical Mirror
      </button>
    </div>

    <div class="control-group">
      <button
        @click="onMirrorHorizontalClick"
        class="toggle"
        :class="{ active: mirrorHorizontal }"
      >
        ↔ Horizontal Mirror
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
interface Props {
  isPlaying: boolean
  speed: number
  fontSize: number
  mirrorVertical: boolean
  mirrorHorizontal: boolean
}

interface Emits {
  (e: 'play-toggle'): void
  (e: 'speed-change', value: number): void
  (e: 'font-size-change', value: number): void
  (e: 'mirror-vertical-toggle'): void
  (e: 'mirror-horizontal-toggle'): void
}

defineProps<Props>()
const emit = defineEmits<Emits>()

const onPlayClick = () => {
  emit('play-toggle')
}

const onSpeedChange = (event: Event) => {
  const target = event.target as HTMLInputElement
  emit('speed-change', parseFloat(target.value))
}

const onFontSizeChange = (event: Event) => {
  const target = event.target as HTMLInputElement
  emit('font-size-change', parseInt(target.value))
}

const onMirrorVerticalClick = () => {
  emit('mirror-vertical-toggle')
}

const onMirrorHorizontalClick = () => {
  emit('mirror-horizontal-toggle')
}
</script>

<style scoped>
.controls {
  background: #1a1a1a;
  padding: 15px;
  border-bottom: 2px solid #333;
  display: flex;
  gap: 15px;
  align-items: center;
  flex-wrap: wrap;
}

.control-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

label {
  font-size: 14px;
  color: #aaa;
}

input[type="range"] {
  width: 120px;
}

input[type="number"] {
  width: 70px;
  padding: 5px;
  background: #333;
  border: 1px solid #555;
  color: #fff;
  border-radius: 4px;
}

button {
  padding: 8px 16px;
  background: #0066cc;
  border: none;
  border-radius: 4px;
  color: white;
  cursor: pointer;
  font-size: 14px;
  transition: background 0.2s;
}

button:hover {
  background: #0052a3;
}

button.toggle {
  background: #333;
}

button.toggle.active {
  background: #0066cc;
}

.speed-value {
  min-width: 40px;
  text-align: center;
  color: #fff;
  font-weight: bold;
}
</style>
