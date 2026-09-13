<script setup lang="ts">
import { computed, ref } from 'vue'
import ModalDialog from '@/components/ModalDialog.vue'
import WorkForm from '@/components/WorkForm.vue'
import WorkCard from '@/components/WorkCard.vue'
import EventCard from '@/components/EventCard.vue'
import ActivityFeed from '@/components/ActivityFeed.vue'
import EmptyState from '@/components/EmptyState.vue'
import { useLoginDialog } from '@/composables/useLoginDialog'
import { useToast } from '@/composables/useToast'
import { useAuthStore } from '@/stores/auth'
import { useCatalogStore } from '@/stores/catalog'
import type { Work } from '@/types'

const auth = useAuthStore()
const catalog = useCatalogStore()
const toast = useToast()
const { openLogin } = useLoginDialog()

const submitting = ref(false)

const site = computed(() => catalog.config.site)

const activeEvents = computed(() => {
  const now = Date.now()
  return catalog.events
    .filter((event) => event.status === 'open' || event.status === 'upcoming')
    .filter((event) => !event.endAt || new Date(event.endAt).getTime() >= now)
    .sort((a, b) => (a.startAt ?? '').localeCompare(b.startAt ?? ''))
})

const latestWorks = computed(() => catalog.works.slice(0, 8))

const submitTarget = computed(() => catalog.defaultEvent)

function startSubmit(): void {
  if (!auth.isLoggedIn) {
    openLogin()
    return
  }
  if (!submitTarget.value) {
    toast.info('目前还没有开放投稿的活动。')
    return
  }
  submitting.value = true
}

function onSaved(work: Work): void {
  catalog.mergeLiveWorks([work])
  submitting.value = false
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
      </div>
    </section>

    <div class="two-col">
      <section class="section">
        <div class="section__head">
          <h2>进行中的活动</h2>
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

  <ModalDialog v-if="submitting" title="提交作品" wide @close="submitting = false">
    <WorkForm :default-event-id="submitTarget?.id" @saved="onSaved" @cancel="submitting = false" />
  </ModalDialog>
</template>
