<template>
  <div class="prompter-container" :class="{ playing: isPlaying }">
    <textarea
      v-if="!isPlaying"
      v-model="editorText"
      class="edit-mode"
      placeholder="Enter your text here... Use [square brackets] for emphasis (will appear in red)"
      :style="{ fontSize: `${fontSize}px` }"
    />

    <div
      v-else
      class="play-mode prompter-content"
      :style="{
        fontSize: `${fontSize}px`,
        transform: transform
      }"
      v-html="highlightedText"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'

interface Props {
  text: string
  fontSize: number
  isPlaying: boolean
  transform: string
  formattedText: string
  currentWordIndex?: number
}

interface Emits {
  (e: 'text-change', value: string): void
}

const props = withDefaults(defineProps<Props>(), {
  currentWordIndex: -1,
})
const emit = defineEmits<Emits>()

// Computed text with current word highlighting
const highlightedText = computed(() => {
  if (props.currentWordIndex < 0) {
    return props.formattedText
  }

  // Split text into words while preserving formatting
  const words = props.text.split(/(\s+)/)
  let wordCount = 0

  const highlighted = words.map((segment) => {
    // Skip whitespace
    if (/^\s+$/.test(segment)) {
      return segment
    }

    const isCurrentWord = wordCount === props.currentWordIndex
    wordCount++

    // Handle emphasis brackets
    if (segment.match(/\[([^\]]+)\]/)) {
      const content = segment.replace(/\[([^\]]+)\]/, '$1')
      if (isCurrentWord) {
        return `<span class="emphasis current-word">${content}</span>`
      }
      return `<span class="emphasis">${content}</span>`
    }

    // Regular word
    if (isCurrentWord) {
      return `<span class="current-word">${segment}</span>`
    }
    return segment
  }).join('')

  return highlighted
})

const editorText = ref(props.text)

// Watch for external text changes
watch(() => props.text, (newText) => {
  editorText.value = newText
})

// Emit text changes to parent
watch(editorText, (newText) => {
  emit('text-change', newText)
})
</script>

<style scoped>
.prompter-container {
  flex: 1;
  overflow: hidden;
  position: relative;
  background: #000;
}

.prompter-content {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  padding: 40px;
  white-space: pre-wrap;
  word-wrap: break-word;
  line-height: 1.6;
}

:deep(.emphasis) {
  color: #ff4444;
  font-weight: bold;
}

:deep(.current-word) {
  background: #0066cc;
  color: #fff;
  padding: 2px 6px;
  border-radius: 4px;
  box-shadow: 0 0 10px rgba(0, 102, 204, 0.5);
  transition: all 0.2s;
}

:deep(.emphasis.current-word) {
  background: #ff4444;
  box-shadow: 0 0 10px rgba(255, 68, 68, 0.5);
}

textarea {
  width: 100%;
  height: 100%;
  background: #1a1a1a;
  border: none;
  color: #fff;
  padding: 40px;
  font-family: inherit;
  font-size: inherit;
  line-height: 1.6;
  resize: none;
  outline: none;
}

textarea::placeholder {
  color: #666;
}
</style>
