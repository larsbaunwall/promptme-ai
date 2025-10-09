<template>
  <div class="ai-controls">
    <button
      @click="onToggleAI"
      class="toggle-button"
      :class="{ active: isActive }"
      :disabled="isLoading"
    >
      <span class="icon">{{ isActive ? '🤖' : '🎤' }}</span>
      <span>{{ isActive ? 'AI ENABLED' : 'ENABLE AI' }}</span>
    </button>

    <p class="engine-note">Speech engine: whisper-web (Xenova)</p>

    <p v-if="error" class="error-message">
      {{ error }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { toRefs } from 'vue'
interface Props {
  isActive: boolean
  isLoading?: boolean
  error?: string | null
}

interface Emits {
  (e: 'toggle'): void
}

const props = withDefaults(defineProps<Props>(), {
  isLoading: false,
  error: null,
})

const { isActive, isLoading, error } = toRefs(props)

const emit = defineEmits<Emits>()

const onToggleAI = () => {
  emit('toggle')
}
</script>

<style scoped>
.ai-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  background: #1a1a1a;
  border-radius: 6px;
  border: 1px solid #2c2c2c;
}

.toggle-button {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  background: #333;
  border: 2px solid #555;
  border-radius: 6px;
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.toggle-button:hover:not(:disabled) {
  background: #444;
  border-color: #666;
}

.toggle-button.active {
  background: #0066cc;
  border-color: #0052a3;
}

.toggle-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.icon {
  font-size: 16px;
}

.mode-selector {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: #ccc;
}

.mode-selector select {
  background: #252525;
  color: #fff;
  border: 1px solid #444;
  border-radius: 4px;
  padding: 4px 6px;
  font-size: 13px;
}

.mode-selector select:disabled {
  opacity: 0.6;
}

.engine-note {
  font-size: 11px;
  color: #888;
  margin: 0;
}

.error-message {
  padding: 6px 10px;
  background: #ff4444;
  color: white;
  border-radius: 4px;
  font-size: 12px;
  max-width: 260px;
}
</style>
