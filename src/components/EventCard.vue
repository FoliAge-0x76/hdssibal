<script setup lang="ts">
import { computed } from 'vue'
import { EVENT_STATUS_LABELS } from '@/services/events'
import { assetUrl } from '@/config'
import type { EventItem } from '@/types'
import { formatDate } from '@/utils/format'

const props = withDefaults(defineProps<{ event: EventItem; count?: number }>(), { count: undefined })

const cover = computed(() => assetUrl(props.event.cover))
const initial = computed(() => props.event.title.trim().charAt(0) || '赛')

const period = computed(() => {
  const { startAt, endAt } = props.event
  if (startAt && endAt) return `${formatDate(startAt)} – ${formatDate(endAt)}`
  if (startAt) return `${formatDate(startAt)} 起`
  return '时间待定'
})
</script>

<template>
  <router-link class="work-card" :to="`/events/${props.event.id}`">
    <img v-if="cover" class="work-card__cover" :src="cover" :alt="`${props.event.title} 封面`" loading="lazy" />
    <div v-else class="work-card__cover work-card__cover--placeholder" aria-hidden="true">{{ initial }}</div>

    <div class="work-card__body">
      <div class="row" style="gap: 8px">
        <span class="badge" :class="`badge--${props.event.status}`">{{ EVENT_STATUS_LABELS[props.event.status] }}</span>
        <span v-if="props.event.acceptSubmissions && props.event.status === 'open'" class="badge badge--open">开放投稿</span>
      </div>
      <h3 class="work-card__title">{{ props.event.title }}</h3>
      <p v-if="props.event.subtitle" class="work-card__summary">{{ props.event.subtitle }}</p>
      <div class="work-card__author">
        <span>{{ period }}</span>
        <span class="spacer"></span>
        <span v-if="props.count !== undefined" class="dim">{{ props.count }} 件作品</span>
      </div>
    </div>
  </router-link>
</template>
