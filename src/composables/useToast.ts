import { ref } from 'vue'

export interface ToastItem {
  id: number
  type: 'success' | 'error' | 'info'
  message: string
}

const toasts = ref<ToastItem[]>([])
let sequence = 0

function push(type: ToastItem['type'], message: string, timeout = 4200): number {
  const id = ++sequence
  toasts.value = [...toasts.value, { id, type, message }]
  if (timeout > 0) {
    window.setTimeout(() => dismiss(id), timeout)
  }
  return id
}

function dismiss(id: number): void {
  toasts.value = toasts.value.filter((toast) => toast.id !== id)
}

export function useToast() {
  return {
    toasts,
    dismiss,
    info: (message: string) => push('info', message),
    success: (message: string) => push('success', message),
    error: (message: string) => push('error', message, 7000),
  }
}
