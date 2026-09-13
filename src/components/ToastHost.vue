<script setup lang="ts">
import { useToast } from '@/composables/useToast'

const { toasts, dismiss } = useToast()
</script>

<template>
  <div class="toast-host" aria-live="polite">
    <div v-for="toast in toasts" :key="toast.id" class="toast" :class="`toast--${toast.type}`">
      <span aria-hidden="true">{{ toast.type === 'success' ? '✓' : toast.type === 'error' ? '!' : 'i' }}</span>
      <span class="spacer">{{ toast.message }}</span>
      <button type="button" aria-label="关闭" @click="dismiss(toast.id)">✕</button>
    </div>
  </div>
</template>
