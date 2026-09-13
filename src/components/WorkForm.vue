<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { assetUrl } from '@/config'
import { useToast } from '@/composables/useToast'
import { ACCEPTED_IMAGE_TYPES, prepareCoverImage } from '@/services/images'
import type { PreparedImage } from '@/services/images'
import { EVENT_STATUS_LABELS } from '@/services/events'
import { renderMarkdown } from '@/services/markdown'
import { saveWork } from '@/services/works'
import type { WorkDraft } from '@/services/works'
import { useAuthStore } from '@/stores/auth'
import { useCatalogStore } from '@/stores/catalog'
import { formatBytes } from '@/utils/encoding'
import { isEventOngoing, remainingLabel } from '@/utils/eventWindow'
import { formatDate } from '@/utils/format'
import { describeUrlProblem } from '@/utils/url'
import type { EventItem, Work, WorkLink } from '@/types'

interface FormState {
  eventId: string
  title: string
  summary: string
  description: string
  tags: string
  chartUrl: string
  chartArtist: string
  chartDesigner: string
  chartBpm: string
  chartDifficulties: string
}

const props = withDefaults(defineProps<{ work?: Work | null; defaultEventId?: string }>(), {
  work: null,
  defaultEventId: undefined,
})

const emit = defineEmits<{ saved: [work: Work]; cancel: [] }>()

const auth = useAuthStore()
const catalog = useCatalogStore()
const toast = useToast()

const form = reactive<FormState>({
  eventId: props.work?.eventId ?? props.defaultEventId ?? '',
  title: props.work?.title ?? '',
  summary: props.work?.summary ?? '',
  description: props.work?.description ?? '',
  tags: (props.work?.tags ?? []).join(', '),
  chartUrl: props.work?.chart?.url ?? '',
  chartArtist: props.work?.chart?.artist ?? '',
  chartDesigner: props.work?.chart?.designer ?? '',
  chartBpm: props.work?.chart?.bpm ?? '',
  chartDifficulties: (props.work?.chart?.difficulties ?? []).join(', '),
})

const links = reactive<WorkLink[]>((props.work?.links ?? []).map((link) => ({ ...link })))

const hasOptionalValues = Boolean(
  props.work?.summary ||
    props.work?.description ||
    props.work?.tags?.length ||
    props.work?.links?.length ||
    props.work?.chart?.designer ||
    props.work?.chart?.bpm ||
    props.work?.chart?.difficulties?.length,
)
const showMore = ref(hasOptionalValues)
const showPreview = ref(false)

const submitting = ref(false)
const error = ref('')

const cover = ref<PreparedImage | null>(null)
const coverPreview = ref('')
const coverFileName = ref('')
const coverBusy = ref(false)
const coverError = ref('')
/** 编辑时选择“移除封面”，只有重新选了图才会被覆盖。 */
const dropExistingCover = ref(false)
const coverInput = ref<HTMLInputElement | null>(null)

const existingCover = computed(() => (props.work?.cover && !dropExistingCover.value ? assetUrl(props.work.cover) : ''))
const coverSrc = computed(() => coverPreview.value || existingCover.value)
const coverReady = computed(() => Boolean(cover.value) || Boolean(existingCover.value))
const coverInfo = computed(() => {
  if (!cover.value) {
    return existingCover.value ? '当前使用的是已保存的封面，可重新选择替换。' : ''
  }
  const size = formatBytes(cover.value.bytes)
  return `${coverFileName.value || '已选择图片'} · ${cover.value.width}×${cover.value.height} · 压缩后 ${size}`
})

const isOngoing = (event: EventItem): boolean => isEventOngoing(event)

/** 只列出“正在进行中”的活动；编辑旧作品时保留它原本所属的活动。 */
const selectableEvents = computed<EventItem[]>(() => {
  const list = catalog.events
    .filter((event) => isEventOngoing(event))
    .sort((a, b) => (a.startAt ?? '').localeCompare(b.startAt ?? ''))

  if (form.eventId && !list.some((event) => event.id === form.eventId)) {
    const current = catalog.eventById(form.eventId)
    if (current) list.unshift(current)
  }
  return list
})

const chartUrlProblem = computed(() => (form.chartUrl.trim() ? describeUrlProblem(form.chartUrl) : null))

const requirements = computed(() => [
  {
    label: '勾选一个正在进行的活动',
    ok: Boolean(form.eventId),
    hint: form.eventId ? catalog.eventTitle(form.eventId) : '未开始 / 已截止的活动不能投稿',
  },
  { label: '填写作品标题', ok: Boolean(form.title.trim()), hint: '会显示在作品卡片上' },
  { label: '选择一张封面图', ok: coverReady.value, hint: '文件名不限，PNG / JPEG / WebP / GIF' },
  {
    label: '填写谱面下载链接',
    ok: Boolean(form.chartUrl.trim()) && !chartUrlProblem.value,
    hint: '必须是 http:// 或 https:// 链接',
  },
])

const canSubmit = computed(() => requirements.value.every((item) => item.ok) && !submitting.value && !coverBusy.value)
const rendered = computed(() => renderMarkdown(form.description))
const acceptAttribute = ACCEPTED_IMAGE_TYPES.join(',')

function toggleEvent(id: string): void {
  form.eventId = form.eventId === id ? '' : id
}

function periodLabel(event: EventItem): string {
  const start = event.startAt ? formatDate(event.startAt) : '待定'
  const end = event.endAt ? formatDate(event.endAt) : '长期'
  return `${start} – ${end}`
}

async function onCoverChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  coverBusy.value = true
  coverError.value = ''
  try {
    const prepared = await prepareCoverImage(file)
    cover.value = prepared
    coverFileName.value = file.name
    coverPreview.value = `data:${prepared.mimeType};base64,${prepared.base64}`
    dropExistingCover.value = false
  } catch (err) {
    cover.value = null
    coverPreview.value = ''
    coverFileName.value = ''
    coverError.value = err instanceof Error ? err.message : '封面处理失败，请换一张图重试。'
    input.value = ''
  } finally {
    coverBusy.value = false
  }
}

function clearCover(): void {
  cover.value = null
  coverPreview.value = ''
  coverFileName.value = ''
  coverError.value = ''
  dropExistingCover.value = Boolean(props.work?.cover)
  if (coverInput.value) coverInput.value.value = ''
}

function addLink(): void {
  links.push({ label: '', url: '' })
}

function removeLink(index: number): void {
  links.splice(index, 1)
}

async function submit(): Promise<void> {
  if (!auth.token || !auth.identity) {
    error.value = '请先登录再投稿。'
    return
  }

  const draft: WorkDraft = {
    eventId: form.eventId,
    title: form.title,
    summary: form.summary,
    description: form.description,
    tags: form.tags
      .split(/[,，、]/)
      .map((tag) => tag.trim())
      .filter(Boolean),
    links: links.map((link) => ({ label: link.label, url: link.url })),
    chartUrl: form.chartUrl,
    chartArtist: form.chartArtist,
    chartDesigner: form.chartDesigner,
    chartBpm: form.chartBpm,
    chartDifficulties: form.chartDifficulties,
  }

  submitting.value = true
  error.value = ''
  try {
    const saved = await saveWork(draft, {
      token: auth.token,
      actor: auth.identity,
      existing: props.work ?? null,
      cover: cover.value,
      removeCover: dropExistingCover.value && !cover.value,
    })
    catalog.mergeLiveWorks([saved])
    toast.success(props.work ? '作品已更新。' : '投稿成功，构建完成后即可在活动页看到。')
    emit('saved', saved)
  } catch (err) {
    error.value = err instanceof Error ? err.message : '提交失败，请稍后再试。'
    toast.error(error.value)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <form class="work-form" @submit.prevent="submit">
    <div v-if="error" class="alert alert--danger">{{ error }}</div>

    <section class="form-section">
      <div class="form-section__head">
        <h4>1. 选择投稿活动 <span class="required">*</span></h4>
        <p class="field__hint">只有正在进行中的活动可以投稿，一次投稿只能选择一个活动。</p>
      </div>

      <div v-if="!selectableEvents.length" class="alert alert--warning">
        当前没有正在进行中的活动，暂时无法投稿。
        <router-link to="/events">查看全部活动 →</router-link>
      </div>

      <div v-else class="event-pick">
        <label
          v-for="event in selectableEvents"
          :key="event.id"
          class="event-pick__item"
          :class="{ 'event-pick__item--checked': form.eventId === event.id }"
        >
          <input type="checkbox" :checked="form.eventId === event.id" @change="toggleEvent(event.id)" />
          <span class="event-pick__body">
            <span class="event-pick__title">{{ event.title }}</span>
            <span class="event-pick__meta">
              <span class="badge" :class="isOngoing(event) ? 'badge--open' : 'badge--archived'">
                {{ isOngoing(event) ? '征集中' : EVENT_STATUS_LABELS[event.status] }}
              </span>
              <span>{{ periodLabel(event) }}</span>
              <span class="dim">{{ remainingLabel(event) }}</span>
            </span>
          </span>
        </label>
      </div>
    </section>

    <section class="form-section">
      <div class="form-section__head">
        <h4>2. 作品信息 <span class="required">*</span></h4>
      </div>
      <div class="form-row">
        <label class="field">
          作品标题 *
          <input v-model="form.title" type="text" maxlength="80" placeholder="例如：星穹列车 ～ Master" />
        </label>
        <label class="field">
          曲师（可选）
          <input v-model="form.chartArtist" type="text" maxlength="60" placeholder="原曲作者" />
        </label>
        <label class="field">
          谱师（可选）
          <input v-model="form.chartDesigner" type="text" maxlength="60" placeholder="谱面作者" />
        </label>
      </div>
    </section>

    <section class="form-section">
      <div class="form-section__head">
        <h4>3. 封面图 <span class="required">*</span></h4>
        <p class="field__hint">支持 PNG / JPEG / WebP / GIF，文件名不限，会自动压缩到 1600px 以内（上限 2 MB）。</p>
      </div>

      <div class="upload-slot">
        <div class="upload-slot__preview">
          <img v-if="coverSrc" :src="coverSrc" alt="封面预览" />
          <span v-else class="upload-slot__placeholder">未选择封面</span>
        </div>
        <div class="upload-slot__body">
          <input
            ref="coverInput"
            class="upload-slot__input"
            type="file"
            :accept="acceptAttribute"
            @change="onCoverChange"
          />
          <p v-if="coverBusy" class="small dim"><span class="spinner"></span> 正在压缩封面…</p>
          <p v-else-if="coverInfo" class="small">{{ coverInfo }}</p>
          <p class="field__hint">封面会作为作品卡片和详情页的主视觉，建议使用 4:3 的横图。</p>
          <button v-if="coverSrc" class="btn btn--sm btn--ghost" type="button" @click="clearCover">移除并重新选择</button>
        </div>
      </div>
      <p v-if="coverError" class="field__error">{{ coverError }}</p>
    </section>

    <section class="form-section">
      <div class="form-section__head">
        <h4>4. 谱面下载链接 <span class="required">*</span></h4>
        <p class="field__hint">网盘分享、直链、GitHub Release 都可以，请确保链接公开可访问且包含完整谱面文件。</p>
      </div>
      <label class="field">
        下载地址 *
        <input v-model="form.chartUrl" type="text" inputmode="url" placeholder="https://example.com/your-chart.zip" />
      </label>
      <p v-if="chartUrlProblem" class="field__error">{{ chartUrlProblem }}</p>
    </section>

    <section class="form-section">
      <button class="btn btn--sm btn--ghost" type="button" @click="showMore = !showMore">
        {{ showMore ? '收起可选信息 ▲' : '展开可选信息（BPM / 难度 / 简介 / 标签 / 其它链接）▼' }}
      </button>

      <div v-if="showMore" class="stack more-fields">
        <div class="form-row">
          <label class="field">
            BPM
            <input v-model="form.chartBpm" type="text" maxlength="20" placeholder="175 或 120-240" />
          </label>
          <label class="field">
            难度等级
            <input v-model="form.chartDifficulties" type="text" placeholder="Easy 3, Hard 7, Master 12+" />
          </label>
        </div>

        <label class="field">
          一句话简介
          <input v-model="form.summary" type="text" maxlength="120" placeholder="会显示在作品卡片上" />
        </label>

        <label class="field">
          详细说明（支持 Markdown）
          <textarea v-model="form.description" rows="8" placeholder="谱面特色、注意事项、更新记录…"></textarea>
        </label>
        <div>
          <button class="btn btn--sm" type="button" @click="showPreview = !showPreview">
            {{ showPreview ? '收起预览' : '预览 Markdown' }}
          </button>
        </div>
        <div v-if="showPreview" class="card markdown" v-html="rendered"></div>

        <label class="field">
          标签（用逗号分隔）
          <input v-model="form.tags" type="text" placeholder="原创, 电音, 高难" />
        </label>

        <div class="stack">
          <div class="row">
            <span class="small dim">其它链接（可选，必须是 http/https 地址）</span>
            <span class="spacer"></span>
            <button class="btn btn--sm" type="button" @click="addLink">+ 添加链接</button>
          </div>
          <div v-for="(link, index) in links" :key="index" class="form-row">
            <label class="field">
              标题
              <input v-model="link.label" type="text" maxlength="40" placeholder="试听 / 教程" />
            </label>
            <label class="field">
              地址
              <input v-model="link.url" type="text" inputmode="url" placeholder="https://…" />
            </label>
            <button class="btn btn--sm btn--danger" type="button" @click="removeLink(index)">删除</button>
          </div>
        </div>
      </div>
    </section>

    <section class="form-section checklist-card">
      <h4>投稿条件</h4>
      <ul class="checklist">
        <li
          v-for="item in requirements"
          :key="item.label"
          class="checklist__item"
          :class="{ 'checklist__item--ok': item.ok }"
        >
          <span class="checklist__mark">{{ item.ok ? '✓' : '✗' }}</span>
          <span>{{ item.label }}<span class="dim"> · {{ item.hint }}</span></span>
        </li>
      </ul>
    </section>

    <div class="form-actions">
      <button class="btn" type="button" @click="emit('cancel')">取消</button>
      <button class="btn btn--primary" type="submit" :disabled="!canSubmit">
        {{ submitting ? '提交中…' : props.work ? '保存修改' : '提交作品' }}
      </button>
    </div>
  </form>
</template>
