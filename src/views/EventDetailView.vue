<script setup lang="ts">
import { computed, ref } from 'vue'
import EmptyState from '@/components/EmptyState.vue'
import EventForm from '@/components/EventForm.vue'
import ModalDialog from '@/components/ModalDialog.vue'
import WorkCard from '@/components/WorkCard.vue'
import WorkForm from '@/components/WorkForm.vue'
import { assetUrl } from '@/config'
import { useLoginDialog } from '@/composables/useLoginDialog'
import { useToast } from '@/composables/useToast'
import { EVENT_STATUS_LABELS } from '@/services/events'
import { renderMarkdown } from '@/services/markdown'
import { useAuthStore } from '@/stores/auth'
import { useCatalogStore } from '@/stores/catalog'
import type { EventItem, Work } from '@/types'
import { formatDate } from '@/utils/format'

const props = defineProps<{ id: string }>()

const auth = useAuthStore()
const catalog = useCatalogStore()
const toast = useToast()
const { openLogin } = useLoginDialog()

const sort = ref<'newest' | 'oldest' | 'title'>('newest')
const submitting = ref(false)
const editing = ref(false)

const event = computed<EventItem | undefined>(() => catalog.eventById(props.id))
const cover = computed(() => assetUrl(event.value?.cover))
const description = computed(() => renderMarkdown(event.value?.description))

const works = computed(() => {
  const list = [...catalog.worksOfEvent(props.id)]
  if (sort.value === 'oldest') return list.reverse()
  if (sort.value === 'title') return list.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'))
  return list
})

const acceptSubmissions = computed(
  () => Boolean(event.value?.acceptSubmissions) && ['open', 'upcoming'].includes(event.value?.status ?? ''),
)

const period = computed(() => {
  const target = event.value
  if (!target) return ''
  const start = formatDate(target.startAt)
  const end = formatDate(target.endAt)
  if (start !== '—' && end !== '—') return `${start} – ${end}`
  if (start !== '—') return `${start} 起`
  return '时间待定'
})

function startSubmit(): void {
  if (!auth.isLoggedIn) {
    openLogin()
    return
  }
  submitting.value = true
}

function onSaved(work: Work): void {
  catalog.mergeLiveWorks([work])
  submitting.value = false
  toast.success('作品已提交。')
}

function onEventSaved(): void {
  editing.value = false
  toast.info('活动已更新，重新构建后对所有人可见。')
}
</script>

<template>
  <div class="container">
    <EmptyState v-if="!event" title="活动不存在" description="它可能已被删除，或者链接有误。">
      <router-link class="btn btn--sm" to="/events">返回活动列表</router-link>
    </EmptyState>

    <template v-else>
      <section class="hero">
        <div class="row" style="margin-bottom: 12px">
          <router-link class="small" to="/events">← 全部活动</router-link>
          <span class="badge" :class="`badge--${event.status}`">{{ EVENT_STATUS_LABELS[event.status] }}</span>
          <span v-if="acceptSubmissions" class="badge badge--open">开放投稿</span>
        </div>
        <h1>{{ event.title }}</h1>
        <p v-if="event.subtitle">{{ event.subtitle }}</p>
        <p class="small dim" style="margin-bottom: 18px">
          {{ period }} · 由
          <a v-if="event.createdBy" :href="`https://github.com/${event.createdBy}`" target="_blank" rel="noopener">
            {{ event.createdBy }}
          </a>
          <span v-else>管理员</span>
          创建
        </p>
        <div class="hero__actions">
          <button v-if="acceptSubmissions" class="btn btn--primary" type="button" @click="startSubmit">投稿至此活动</button>
          <button v-else class="btn" type="button" disabled>该活动未开放投稿</button>
          <button v-if="auth.isAdmin" class="btn" type="button" @click="editing = true">编辑活动</button>
        </div>
      </section>

      <img v-if="cover" :src="cover" :alt="`${event.title} 封面`" class="cover-preview" style="margin-bottom: 28px" />

      <div v-if="event.description" class="card markdown section" v-html="description"></div>

      <section class="section">
        <div class="section__head">
          <h2>作品（{{ works.length }}）</h2>
          <div class="row" v-if="works.length > 1">
            <button class="btn btn--sm" :class="{ 'btn--primary': sort === 'newest' }" type="button" @click="sort = 'newest'">
              最新
            </button>
            <button class="btn btn--sm" :class="{ 'btn--primary': sort === 'oldest' }" type="button" @click="sort = 'oldest'">
              最早
            </button>
            <button class="btn btn--sm" :class="{ 'btn--primary': sort === 'title' }" type="button" @click="sort = 'title'">
              标题
            </button>
          </div>
        </div>

        <EmptyState v-if="!works.length" title="这个活动还没有作品" description="成为第一个投稿的人吧。">
          <button v-if="acceptSubmissions" class="btn btn--primary btn--sm" type="button" @click="startSubmit">投稿</button>
        </EmptyState>
        <div v-else class="grid">
          <WorkCard v-for="work in works" :key="work.id" :work="work" />
        </div>
      </section>
    </template>
  </div>

  <ModalDialog v-if="submitting" title="投稿" wide @close="submitting = false">
    <WorkForm :default-event-id="props.id" @saved="onSaved" @cancel="submitting = false" />
  </ModalDialog>

  <ModalDialog v-if="editing && event" title="编辑活动" wide @close="editing = false">
    <EventForm :event="event" @saved="onEventSaved" @cancel="editing = false" />
  </ModalDialog>
</template>
