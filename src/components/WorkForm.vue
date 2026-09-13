<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { assetUrl } from '@/config'
import { useToast } from '@/composables/useToast'
import { MAX_UPLOAD_BYTES, prepareCoverImage } from '@/services/images'
import { EVENT_STATUS_LABELS } from '@/services/events'
import { renderMarkdown } from '@/services/markdown'
import { saveWork } from '@/services/works'
import { useAuthStore } from '@/stores/auth'
import { useCatalogStore } from '@/stores/catalog'
import type { Work, WorkLink } from '@/types'
import { formatBytes } from '@/utils/encoding'

const props = defineProps<{ work?: Work | null; defaultEventId?: string }>()
const emit = defineEmits<{ saved: [Work]; cancel: [] }>()

const auth = useAuthStore()
const catalog = useCatalogStore()
const toast = useToast()

interface LinkDraft {
  label: string
  url: string
}

const form = reactive({
  eventId: '',
  title: '',
  summary: '',
  description: '',
  tags: '',
  links: [] as LinkDraft[],
})

const coverFile = ref<File | null>(null)
const coverPreview = ref<string | null>(null)
const removeCover = ref(false)
const submitting = ref(false)
const progress = ref<string | null>(null)
const error = ref<string | null>(null)
const showPreview = ref(false)

const isEditing = computed(() => Boolean(props.work))
const existingCover = computed(() => assetUrl(props.work?.cover))
const rendered = computed(() => renderMarkdown(form.description))

/** 可投稿的活动排在前面；编辑作品时也要保证当前活动在列表里。 */
const selectableEvents = computed(() => {
  const events = [...catalog.events]
  const current = props.work?.eventId
  return events
    .filter((event) => event.acceptSubmissions || event.status === 'open' || event.id === current)
    .sort((a, b) => Number(b.acceptSubmissions) - Number(a.acceptSubmissions) || b.createdAt.localeCompare(a.createdAt))
})

const noSelectableEvent = computed(() => selectableEvents.value.length === 0)

function resetFromWork(): void {
  const work = props.work
  form.eventId = work?.eventId ?? props.defaultEventId ?? ''
  form.title = work?.title ?? ''
  form.summary = work?.summary ?? ''
  form.description = work?.description ?? ''
  form.tags = (work?.tags ?? []).join(', ')
  form.links = (work?.links ?? []).map((link: WorkLink) => ({ label: link.label, url: link.url }))
  coverFile.value = null
  removeCover.value = false
  setPreview(null)
  error.value = null
}

function setPreview(url: string | null): void {
  if (coverPreview.value) URL.revokeObjectURL(coverPreview.value)
  coverPreview.value = url
}

watch(
  () => [props.work?.id, props.defaultEventId],
  () => {
    resetFromWork()
    if (!form.eventId && selectableEvents.value.length) form.eventId = selectableEvents.value[0].id
  },
  { immediate: true },
)

onBeforeUnmount(() => setPreview(null))

function onCoverChange(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0] ?? null
  if (!file) return
  if (file.size > 20 * 1024 * 1024) {
    error.value = '原图请控制在 20 MB 以内。'
    input.value = ''
    return
  }
  error.value = null
  coverFile.value = file
  removeCover.value = false
  setPreview(URL.createObjectURL(file))
}

function clearCover(): void {
  coverFile.value = null
  setPreview(null)
  removeCover.value = true
}

function addLink(): void {
  form.links.push({ label: '', url: '' })
}

function removeLink(index: number): void {
  form.links.splice(index, 1)
}

async function submit(): Promise<void> {
  error.value = null
  if (!auth.token || !auth.identity) {
    error.value = '请先登录后再提交作品。'
    return
  }
  if (!form.title.trim()) {
    error.value = '请填写作品标题。'
    return
  }
  if (!form.eventId) {
    error.value = '请选择作品所属的活动。'
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

    const saved = await saveWork(
      {
        eventId: form.eventId,
        title: form.title,
        summary: form.summary,
        description: form.description,
        tags: form.tags.split(/[,，]/),
        links: form.links,
      },
      {
        token: auth.token,
        actor: auth.identity,
        existing: props.work ?? null,
        cover,
        removeCover: removeCover.value,
      },
    )

    toast.success(isEditing.value ? '作品已更新，稍等片刻后全站可见。' : '作品已提交，稍等片刻后全站可见。')
    emit('saved', saved)
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : '提交失败，请稍后重试。'
  } finally {
    submitting.value = false
    progress.value = null
  }
}
</script>

<template>
  <form @submit.prevent="submit">
    <div v-if="error" class="alert alert--danger">{{ error }}</div>

    <div v-if="noSelectableEvent" class="alert alert--warning">
      目前没有可投稿的活动。请联系管理员开启一个活动后再提交作品。
    </div>

    <div class="field">
      <label for="work-title">作品标题 *</label>
      <input id="work-title" v-model="form.title" type="text" maxlength="80" placeholder="给作品起个名字" />
    </div>

    <div class="field">
      <label for="work-event">所属活动 *</label>
      <select id="work-event" v-model="form.eventId">
        <option value="" disabled>请选择活动</option>
        <option v-for="event in selectableEvents" :key="event.id" :value="event.id">
          {{ event.title }}（{{ EVENT_STATUS_LABELS[event.status] }}）
        </option>
      </select>
    </div>

    <div class="field">
      <label for="work-summary">一句话简介</label>
      <input id="work-summary" v-model="form.summary" type="text" maxlength="120" placeholder="展示在封面卡片上的一句话" />
    </div>

    <div class="field">
      <label for="work-description">作品详情（支持 Markdown）</label>
      <textarea id="work-description" v-model="form.description" placeholder="介绍一下你的作品、玩法、用到的技术…"></textarea>
      <div class="row">
        <button class="btn btn--sm btn--ghost" type="button" @click="showPreview = !showPreview">
          {{ showPreview ? '关闭预览' : '预览 Markdown' }}
        </button>
      </div>
      <div v-if="showPreview" class="card markdown" v-html="rendered"></div>
    </div>

    <div class="field">
      <label for="work-tags">标签</label>
      <input id="work-tags" v-model="form.tags" type="text" placeholder="用逗号分隔，例如：像素画, 解谜" />
    </div>

    <div class="field">
      <label>相关链接</label>
      <div v-for="(link, index) in form.links" :key="index" class="row" style="margin-bottom: 8px">
        <input v-model="link.label" type="text" placeholder="名称（如 Demo）" style="max-width: 150px" />
        <input v-model="link.url" type="url" placeholder="https://…" />
        <button class="btn btn--sm btn--ghost" type="button" @click="removeLink(index)">删除</button>
      </div>
      <button class="btn btn--sm" type="button" @click="addLink">+ 添加链接</button>
    </div>

    <div class="field">
      <label for="work-cover">封面图</label>
      <input id="work-cover" type="file" accept="image/png,image/jpeg,image/webp,image/gif" @change="onCoverChange" />
      <span class="field__hint">
        支持 PNG / JPEG / WebP / GIF，会自动压缩到最长边 1600px、{{ formatBytes(MAX_UPLOAD_BYTES) }} 以内。
      </span>
      <div class="row" style="margin-top: 10px; align-items: flex-start">
        <div v-if="coverPreview || (existingCover && !removeCover)" style="width: 220px">
          <img class="cover-preview" :src="coverPreview ?? existingCover" alt="封面预览" />
          <button class="btn btn--sm btn--ghost" type="button" style="margin-top: 6px" @click="clearCover">
            移除封面
          </button>
        </div>
        <p v-else class="small dim">尚未设置封面，作品卡片会显示标题首字。</p>
      </div>
    </div>

    <div class="modal__actions">
      <span v-if="progress" class="row small dim">
        <span class="spinner"></span>
        {{ progress }}
      </span>
      <span class="spacer"></span>
      <button class="btn" type="button" :disabled="submitting" @click="emit('cancel')">取消</button>
      <button class="btn btn--primary" type="submit" :disabled="submitting || noSelectableEvent">
        {{ isEditing ? '保存修改' : '提交作品' }}
      </button>
    </div>
  </form>
</template>
