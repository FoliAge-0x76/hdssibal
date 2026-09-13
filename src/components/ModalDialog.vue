<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'

const props = withDefaults(defineProps<{ title: string; wide?: boolean }>(), { wide: false })
const emit = defineEmits<{ close: [] }>()

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') emit('close')
}

onMounted(() => document.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <div class="modal" :class="{ 'modal--wide': props.wide }" role="dialog" aria-modal="true">
      <div class="modal__head">
        <h3>{{ title }}</h3>
        <button class="btn btn--ghost btn--sm" type="button" aria-label="关闭" @click="emit('close')">✕</button>
      </div>
      <slot />
    </div>
  </div>
</template>
