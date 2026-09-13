<script setup lang="ts">
import ModalDialog from './ModalDialog.vue'

const props = withDefaults(
  defineProps<{
    title: string
    message: string
    confirmLabel?: string
    cancelLabel?: string
    danger?: boolean
    busy?: boolean
  }>(),
  { confirmLabel: '确定', cancelLabel: '取消', danger: false, busy: false },
)

const emit = defineEmits<{ confirm: []; cancel: [] }>()
</script>

<template>
  <ModalDialog :title="props.title" @close="emit('cancel')">
    <p style="white-space: pre-line; margin: 0">{{ props.message }}</p>
    <div class="modal__actions">
      <button class="btn" type="button" :disabled="props.busy" @click="emit('cancel')">
        {{ props.cancelLabel }}
      </button>
      <button
        class="btn"
        :class="props.danger ? 'btn--danger' : 'btn--primary'"
        type="button"
        :disabled="props.busy"
        @click="emit('confirm')"
      >
        <span v-if="props.busy" class="spinner"></span>
        {{ props.confirmLabel }}
      </button>
    </div>
  </ModalDialog>
</template>
