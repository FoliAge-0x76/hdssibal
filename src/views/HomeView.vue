<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import WorkCard from '@/components/WorkCard.vue'
import EventCard from '@/components/EventCard.vue'
import ActivityFeed from '@/components/ActivityFeed.vue'
import EmptyState from '@/components/EmptyState.vue'
import { useLoginDialog } from '@/composables/useLoginDialog'
import { useToast } from '@/composables/useToast'
import { useAuthStore } from '@/stores/auth'
import { useCatalogStore } from '@/stores/catalog'
import { isEventOngoing } from '@/utils/eventWindow'

const auth = useAuthStore()
const catalog = useCatalogStore()
const toast = useToast()
const router = useRouter()
const { openLogin } = useLoginDialog()

const site = computed(() => catalog.config.site)

const ongoingEvents = computed(() =>
  catalog.events
    .filter((event) => isEventOngoing(event))
    .sort((a, b) => (a.startAt ?? '').localeCompare(b.startAt ?? '')),
)

const activeEvents = computed(() => {
  if (ongoingEvents.value.length) return ongoingEvents.value
  const now = Date.now()
  return catalog.events
    .filter((event) => event.status === 'upcoming')
    .filter((event) => !event.endAt || Date.parse(event.endAt) >= now)
    .sort((a, b) => (a.startAt ?? '').localeCompare(b.startAt ?? ''))
})

const activeEventsTitle = computed(() => (ongoingEvents.value.length ? '进行中的活动' : '即将开始的活动'))

const latestWorks = computed(() => catalog.works.slice(0, 8))

function startSubmit(): void {
  if (!auth.isLoggedIn) {
    openLogin()
    return
  }
  if (!catalog.defaultEvent) {
    toast.info('目前没有正在进行中的活动，暂时无法投稿。')
    return
  }
  void router.push({ name: 'submit' })
}
</script>

<template>
  <div class="container">
    <section class="hero">
      <h1>{{ site.name }}</h1>
      <p>{{ site.tagline ?? site.description ?? '在这里举办比赛、征集作品，并把它们展示给所有人。' }}</p>
      <div class="hero__actions">
        <button class="btn btn--primary" type="button" @click="startSubmit">提交作品</button>
        <router-link class="btn" to="/events">浏览活动</router-link>
        <router-link v-if="auth.isAdmin" class="btn" to="/admin">管理后台</router-link>
      </div>    </section>

    <div class="two-col">
      <section class="section">
        <div class="section__head">
          <h2>{{ activeEventsTitle }}</h2>
          <router-link class="small" to="/events">全部活动 →</router-link>
        </div>

        <EmptyState v-if="!activeEvents.length" title="暂时没有进行中的活动" description="管理员创建活动后会显示在这里。" />
        <div v-else class="grid">
          <EventCard
            v-for="event in activeEvents"
            :key="event.id"
            :event="event"
            :count="catalog.worksOfEvent(event.id).length"
          />
        </div>
      </section>

      <aside class="section card">
        <div class="section__head">
          <h2>最近活动</h2>
        </div>
        <ActivityFeed :items="catalog.activities" />
      </aside>
    </div>

    <section class="section">
      <div class="section__head">
        <h2>最新作品</h2>
        <span class="small dim">共 {{ catalog.works.length }} 件</span>
      </div>

      <EmptyState v-if="!latestWorks.length" title="还没有作品" description="成为第一个提交作品的人吧。">
        <button class="btn btn--primary btn--sm" type="button" @click="startSubmit">提交作品</button>
      </EmptyState>
      <div v-else class="grid">
        <WorkCard v-for="work in latestWorks" :key="work.id" :work="work" show-event />
      </div>
    </section>
  </div>
</template>
