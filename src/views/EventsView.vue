<script setup lang="ts">
import { computed, ref } from 'vue'
import EventCard from '@/components/EventCard.vue'
import EmptyState from '@/components/EmptyState.vue'
import { EVENT_STATUS_LABELS } from '@/services/events'
import { useCatalogStore } from '@/stores/catalog'
import type { EventStatus } from '@/types'

const catalog = useCatalogStore()

type Filter = 'all' | EventStatus
const filter = ref<Filter>('all')

const filters: Array<{ value: Filter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'open', label: EVENT_STATUS_LABELS.open },
  { value: 'upcoming', label: EVENT_STATUS_LABELS.upcoming },
  { value: 'closed', label: EVENT_STATUS_LABELS.closed },
  { value: 'archived', label: EVENT_STATUS_LABELS.archived },
]

const visibleEvents = computed(() => {
  const events =
    filter.value === 'all'
      ? catalog.events.filter((event) => event.status !== 'draft')
      : catalog.events.filter((event) => event.status === filter.value)
  return events.sort((a, b) => (b.startAt ?? b.createdAt).localeCompare(a.startAt ?? a.createdAt))
})
</script>

<template>
  <div class="container">
    <section class="hero">
      <h1>活动列表</h1>
      <p>每个活动都是一个独立的比赛会场，点进去可以看到所有已提交的作品。</p>
    </section>

    <div class="row" style="margin-bottom: 20px">
      <button
        v-for="item in filters"
        :key="item.value"
        class="btn btn--sm"
        :class="{ 'btn--primary': filter === item.value }"
        type="button"
        @click="filter = item.value"
      >
        {{ item.label }}
      </button>
    </div>

    <EmptyState v-if="!visibleEvents.length" title="没有符合条件的活动" description="换个筛选条件试试。" />
    <div v-else class="grid">
      <EventCard
        v-for="event in visibleEvents"
        :key="event.id"
        :event="event"
        :count="catalog.worksOfEvent(event.id).length"
      />
    </div>
  </div>
</template>
