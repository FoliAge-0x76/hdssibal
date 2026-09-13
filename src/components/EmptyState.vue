<script setup lang="ts">
const props = withDefaults(defineProps<{ title: string; description?: string }>(), { description: '' })
</script>

<template>
  <div class="empty">
    <div class="empty__title">{{ props.title }}</div>
    <div v-if="props.description" class="small">{{ props.description }}</div>
    <div v-if="$slots.default" style="margin-top: 14px">
      <slot />
    </div>
  </div>
</template>
