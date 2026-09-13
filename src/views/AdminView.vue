<script setup lang="ts">
import { computed, ref } from 'vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import EmptyState from '@/components/EmptyState.vue'
import EventForm from '@/components/EventForm.vue'
import ModalDialog from '@/components/ModalDialog.vue'
import { useLoginDialog } from '@/composables/useLoginDialog'
import { useToast } from '@/composables/useToast'
import { EVENT_STATUS_LABELS, deleteEvent } from '@/services/events'
import { deleteWork } from '@/services/works'
import { useAuthStore } from '@/stores/auth'
import { useCatalogStore } from '@/stores/catalog'
import type { EventItem, Work } from '@/types'
import { formatDateTime } from '@/utils/format'

const auth = useAuthStore()
const catalog = useCatalogStore()
const toast = useToast()
const { openLogin } = useLoginDialog()

const tab = ref<'events' | 'works'>('events')
const creatingEvent = ref(false)
const editingEvent = ref<EventItem | null>(null)
const deleteEventTarget = ref<EventItem | null>(null)
const deleteWorkTarget = ref<Work | null>(null)
const forceDelete = ref(false)
const busy = ref(false)
const createdLive = ref<EventItem[]>([])

const events = computed(() => {
  const merged = new Map(catalog.events.map((event) => [event.id, event]))
  for (const event of createdLive.value) merged.set(event.id, event)
  return [...merged.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
})

const works = computed(() => [...catalog.works].sort((a, b) => b.createdAt.localeCompare(a.createdAt)))

async function confirmDeleteEvent(): Promise<void> {
  if (!deleteEventTarget.value || !auth.token) return
  busy.value = true
  try {
    await deleteEvent(deleteEventTarget.value, auth.token, forceDelete.value)
    toast.success('活动已删除。')
    const removedId = deleteEventTarget.value.id
    catalog.events = catalog.events.filter((event) => event.id !== removedId)
    createdLive.value = createdLive.value.filter((event) => event.id !== removedId)
    deleteEventTarget.value = null
    forceDelete.value = false
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : '删除失败。'
    if (!forceDelete.value) {
      forceDelete.value = true
      toast.error(`${message} 再次确认将强制删除。`)
    } else {
      toast.error(message)
    }
  } finally {
    busy.value = false
  }
}

async function confirmDeleteWork(): Promise<void> {
  if (!deleteWorkTarget.value || !auth.token) return
  busy.value = true
  try {
    await deleteWork(deleteWorkTarget.value, auth.token)
    catalog.works = catalog.works.filter((work) => work.id !== deleteWorkTarget.value!.id)
    toast.success('作品已删除。')
    deleteWorkTarget.value = null
  } catch (caught) {
    toast.error(caught instanceof Error ? caught.message : '删除失败。')
  } finally {
    busy.value = false
  }
}

function askDeleteEvent(event: EventItem): void {
  deleteEventTarget.value = event
  forceDelete.value = false
}

function cancelDeleteEvent(): void {
  deleteEventTarget.value = null
  forceDelete.value = false
}

function onEventSaved(event: EventItem): void {
  createdLive.value = [...createdLive.value.filter((item) => item.id !== event.id), event]
  creatingEvent.value = false
  editingEvent.value = null
  toast.info('活动已保存，重新构建后对所有访客可见。')
}
</script>

<template>
  <div class="container">
    <section class="hero">
      <h1>管理后台</h1>
      <p>创建与维护活动、清理违规或重复的作品。所有操作都会直接以你的账户名义提交到仓库。</p>
    </section>

    <EmptyState v-if="!auth.isLoggedIn" title="请先登录" description="只有仓库管理员可以进入这里。">
      <button class="btn btn--primary" type="button" @click="openLogin()">登录</button>
    </EmptyState>

    <EmptyState
      v-else-if="!auth.isAdmin"
      title="没有管理权限"
      description="当前账户不是该仓库的管理员，也不在 config.json 的 admins 白名单中。"
    />

    <template v-else>
      <div class="row" style="margin-bottom: 20px">
        <button class="btn btn--sm" :class="{ 'btn--primary': tab === 'events' }" type="button" @click="tab = 'events'">
          活动管理
        </button>
        <button class="btn btn--sm" :class="{ 'btn--primary': tab === 'works' }" type="button" @click="tab = 'works'">
          作品管理
        </button>
      </div>

      <section v-if="tab === 'events'" class="section">
        <div class="section__head">
          <h2>活动（{{ events.length }}）</h2>
          <button class="btn btn--primary btn--sm" type="button" @click="creatingEvent = true">+ 新建活动</button>
        </div>

        <EmptyState v-if="!events.length" title="还没有活动" description="新建一个活动后参赛者才能投稿。" />
        <div v-else class="stack">
          <div v-for="event in events" :key="event.id" class="card row" style="align-items: flex-start">
            <div style="flex: 1; min-width: 0">
              <div class="row" style="margin-bottom: 4px">
                <span class="badge" :class="`badge--${event.status}`">{{ EVENT_STATUS_LABELS[event.status] }}</span>
                <span v-if="event.acceptSubmissions" class="badge badge--open">开放投稿</span>
                <span class="dim small">{{ catalog.worksOfEvent(event.id).length }} 件作品</span>
              </div>
              <h3 style="margin: 0 0 2px">
                <router-link :to="`/events/${event.id}`">{{ event.title }}</router-link>
              </h3>
              <p class="small dim" style="margin: 0">
                ID <code>{{ event.id }}</code> · 更新于 {{ formatDateTime(event.updatedAt) }}
              </p>
            </div>
            <div class="row">
              <button class="btn btn--sm" type="button" @click="editingEvent = event">编辑</button>
              <button class="btn btn--sm btn--danger" type="button" @click="askDeleteEvent(event)">删除</button>
            </div>
          </div>
        </div>
      </section>

      <section v-else class="section">
        <div class="section__head">
          <h2>作品（{{ works.length }}）</h2>
          <span class="small dim">删除操作不可在页面内撤销</span>
        </div>

        <EmptyState v-if="!works.length" title="还没有作品" />
        <div v-else class="stack">
          <div v-for="work in works" :key="work.id" class="card row">
            <div style="flex: 1; min-width: 0">
              <h3 style="margin: 0 0 2px">
                <router-link :to="`/works/${work.id}`">{{ work.title }}</router-link>
              </h3>
              <p class="small dim" style="margin: 0">
                作者 {{ work.author.login }} · 活动 {{ catalog.eventTitle(work.eventId) }} · 提交于
                {{ formatDateTime(work.createdAt) }}
              </p>
            </div>
            <button class="btn btn--sm btn--danger" type="button" @click="deleteWorkTarget = work">删除</button>
          </div>
        </div>
      </section>
    </template>
  </div>

  <ModalDialog v-if="creatingEvent" title="新建活动" wide @close="creatingEvent = false">
    <EventForm @saved="onEventSaved" @cancel="creatingEvent = false" />
  </ModalDialog>

  <ModalDialog v-if="editingEvent" title="编辑活动" wide @close="editingEvent = null">
    <EventForm :event="editingEvent" @saved="onEventSaved" @cancel="editingEvent = null" />
  </ModalDialog>

  <ConfirmDialog
    v-if="deleteEventTarget"
    title="删除活动"
    danger
    :confirm-label="forceDelete ? '强制删除' : '确认删除'"
    :busy="busy"
    :message="
      forceDelete
        ? `活动「${deleteEventTarget.title}」下仍有作品。强制删除只会移除活动本身，这些作品将无法再从活动页访问。确定继续吗？`
        : `将删除活动「${deleteEventTarget.title}」及其封面。若活动下仍有作品，会先提示你确认。`
    "
    @confirm="confirmDeleteEvent"
    @cancel="cancelDeleteEvent"
  />

  <ConfirmDialog
    v-if="deleteWorkTarget"
    title="删除作品"
    danger
    confirm-label="确认删除"
    :busy="busy"
    :message="`将删除《${deleteWorkTarget.title}》（作者 ${deleteWorkTarget.author.login}）及其封面文件。`"
    @confirm="confirmDeleteWork"
    @cancel="deleteWorkTarget = null"
  />
</template>