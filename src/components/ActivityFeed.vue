<script setup lang="ts">
import EmptyState from './EmptyState.vue'
import type { ActivityItem } from '@/types'
import { avatarOf } from '@/utils/identity'
import { formatRelative } from '@/utils/format'

const props = defineProps<{ items: ActivityItem[] }>()

function verbOf(item: ActivityItem): string {
  switch (item.type) {
    case 'work.created':
      return '提交了作品'
    case 'work.updated':
      return '更新了作品'
    case 'event.created':
      return '发布了活动'
    case 'event.updated':
      return '调整了活动'
    default:
      return '有新动态'
  }
}

function titleOf(item: ActivityItem): string {
  if (item.work) return `《${item.work.title}》`
  if (item.event) return `「${item.event.title}」`
  return ''
}

function linkOf(item: ActivityItem): string | null {
  if (item.work) return `/works/${item.work.id}`
  if (item.event) return `/events/${item.event.id}`
  return null
}
</script>

<template>
  <EmptyState v-if="!props.items.length" title="还没有动态" description="等第一件作品提交后就会显示在这里。" />
  <ul v-else class="activity-list">
    <li v-for="item in props.items" :key="item.id" class="activity-item">
      <img :src="avatarOf(item.actor, 60)" :alt="item.actor.login" loading="lazy" />
      <div class="activity-item__text">
        <a :href="`https://github.com/${item.actor.login}`" target="_blank" rel="noopener">{{ item.actor.login }}</a>
        {{ verbOf(item) }}
        <router-link v-if="linkOf(item)" :to="linkOf(item)!">{{ titleOf(item) }}</router-link>
      </div>
      <span class="activity-item__time">{{ formatRelative(item.at) }}</span>
    </li>
  </ul>
</template>
