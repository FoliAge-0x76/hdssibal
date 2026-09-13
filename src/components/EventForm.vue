<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { assetUrl } from '@/config'
import { useToast } from '@/composables/useToast'
import { EVENT_STATUS_LABELS, saveEvent } from '@/services/events'
import { MAX_UPLOAD_BYTES, prepareCoverImage } from '@/services/images'
import { renderMarkdown } from '@/services/markdown'
import { useAuthStore } from '@/stores/auth'
import type { EventItem, EventStatus } from '@/types'
import { formatBytes } from '@/utils/encoding'

const props = defineProps<{ event?: EventItem | null }>()
const emit = defineEmits<{ saved: [EventItem]; cancel: [] }>()

const auth = useAuthStore()
const toast = useToast()

const statuses: EventStatus[] = ['draft', 'upcoming', 'open', 'closed', 'archived']

const form = reactive({
  title: '',
  subtitle: '',
  description: '',
  status: 'draft' as EventStatus,
  startAt: '',
  endAt: '',
  acceptSubmissions: false,
})

const coverFile = ref<File | null>(null)
const coverPreview = ref<string | null>(null)
const removeCover = ref(false)
const submitting = ref(false)
const progress = ref<string | null>(null)
const error = ref<string | null>(null)

const isEditing = computed(() => Boolean(props.event))
const existingCover = computed(() => assetUrl(props.event?.cover))
const rendered = computed(() => renderMarkdown(form.description))

function toDateInput(value?: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10)
}

function setPreview(url: string | null): void {
  if (coverPreview.value) URL.revokeObjectURL(coverPreview.value)
  coverPreview.value = url
}

watch(
  () => props.event?.id,
  () => {
    const event = props.event
    form.title = event?.title ?? ''
    form.subtitle = event?.subtitle ?? ''
    form.description = event?.description ?? ''
    form.status = event?.status ?? 'draft'
    form.startAt = toDateInput(event?.startAt)
    form.endAt = toDateInput(event?.endAt)
    form.acceptSubmissions = event?.acceptSubmissions ?? false
    coverFile.value = null
    removeCover.value = false
    setPreview(null)
    error.value = null
  },
  { immediate: true },
)

onBeforeUnmount(() => setPreview(null))

function onCoverChange(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0] ?? null
  if (!file) return
  coverFile.value = file
  removeCover.value = false
  setPreview(URL.createObjectURL(file))
}

function clearCover(): void {
  coverFile.value = null
  setPreview(null)
  removeCover.value = true
}

async function submit(): Promise<void> {
  error.value = null
  if (!auth.token || !auth.identity) {
    error.value = '请先登录。'
    return
  }
  if (!form.title.trim()) {
    error.value = '请填写活动名称。'
    return
  }
  if (form.startAt && form.endAt && form.endAt < form.startAt) {
    error.value = '结束时间不能早于开始时间。'
    return
  }

  submitting.value = true
  try {
    let cover = null
    if (coverFile.value) {
      progress.value = '正在压缩封面…'
      cover = await prepareCoverImage(coverFile.value)
      progress.value = `正在上传封面（${formatBytes(cover.bytes)}）…`
    } else {
      progress.value = '正在提交…'
    }

    const saved = await saveEvent(
      {
        title: form.title,
        subtitle: form.subtitle,
        description: form.description,
        status: form.status,
        startAt: form.startAt,
        endAt: form.endAt,
        acceptSubmissions: form.acceptSubmissions,
      },
      {
        token: auth.token,
        actor: auth.identity,
        existing: props.event ?? null,
        cover,
        removeCover: removeCover.value,
      },
    )

    toast.success(isEditing.value ? '活动已更新。' : '活动已创建。')
    emit('saved', saved)
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : '保存失败，请稍后重试。'
  } finally {
    submitting.value = false
    progress.value = null
  }
}
</script>

<template>
  <form @submit.prevent="submit">
    <div v-if="error" class="alert alert--danger">{{ error }}</div>

    <div class="field">
      <label for="event-title">活动名称 *</label>
      <input id="event-title" v-model="form.title" type="text" maxlength="80" placeholder="例如：2026 春季像素画大赛" />
    </div>

    <div class="field">
      <label for="event-subtitle">副标题</label>
      <input id="event-subtitle" v-model="form.subtitle" type="text" maxlength="120" placeholder="一句话说明这个活动" />
    </div>

    <div class="form-row">
      <div class="field">
        <label for="event-status">状态</label>
        <select id="event-status" v-model="form.status">
          <option v-for="status in statuses" :key="status" :value="status">{{ EVENT_STATUS_LABELS[status] }}</option>
        </select>
      </div>
      <div class="field">
        <label for="event-start">开始日期</label>
        <input id="event-start" v-model="form.startAt" type="date" />
      </div>
      <div class="field">
        <label for="event-end">结束日期</label>
        <input id="event-end" v-model="form.endAt" type="date" />
      </div>
    </div>

    <label class="checkbox" style="margin-bottom: 14px">
      <input v-model="form.acceptSubmissions" type="checkbox" />
      开放投稿（参赛者可以在「我的作品」中向该活动提交作品）
    </label>

    <div class="field">
      <label for="event-description">活动说明（支持 Markdown）</label>
      <textarea id="event-description" v-model="form.description" placeholder="赛制、评分标准、奖品…"></textarea>
    </div>

    <div v-if="form.description" class="card markdown" style="margin-bottom: 14px" v-html="rendered"></div>

    <div class="field">
      <label for="event-cover">活动封面</label>
      <input id="event-cover" type="file" accept="image/png,image/jpeg,image/webp,image/gif" @change="onCoverChange" />
      <span class="field__hint">会自动压缩到最长边 1600px、{{ formatBytes(MAX_UPLOAD_BYTES) }} 以内。</span>
      <div class="row" style="margin-top: 10px; align-items: flex-start">
        <div v-if="coverPreview || (existingCover && !removeCover)" style="width: 220px">
          <img class="cover-preview" :src="coverPreview ?? existingCover" alt="封面预览" />
          <button class="btn btn--sm btn--ghost" type="button" style="margin-top: 6px" @click="clearCover">移除封面</button>
        </div>
        <p v-else class="small dim">尚未设置封面。</p>
      </div>
    </div>

    <div class="modal__actions">
      <span v-if="progress" class="row small dim">
        <span class="spinner"></span>
        {{ progress }}
      </span>
      <span class="spacer"></span>
      <button class="btn" type="button" :disabled="submitting" @click="emit('cancel')">取消</button>
      <button class="btn btn--primary" type="submit" :disabled="submitting">
        {{ isEditing ? '保存修改' : '创建活动' }}
      </button>
    </div>
  </form>
</template>
