<script setup lang="ts">
import { computed } from 'vue'
import { assetUrl } from '@/config'
import { useCatalogStore } from '@/stores/catalog'
import type { Work } from '@/types'
import { avatarOf } from '@/utils/identity'
import { formatDate } from '@/utils/format'

const props = withDefaults(defineProps<{ work: Work; showEvent?: boolean }>(), { showEvent: false })

const catalog = useCatalogStore()

const cover = computed(() => assetUrl(props.work.cover))
const initial = computed(() => props.work.title.trim().charAt(0) || '作')
const avatar = computed(() => avatarOf(props.work.author, 40))
</script>

<template>
  <router-link class="work-card" :to="`/works/${props.work.id}`">
    <img v-if="cover" class="work-card__cover" :src="cover" :alt="`${props.work.title} 封面`" loading="lazy" />
    <div v-else class="work-card__cover work-card__cover--placeholder" aria-hidden="true">{{ initial }}</div>

    <div class="work-card__body">
      <h3 class="work-card__title">{{ props.work.title }}</h3>
      <p v-if="props.work.summary" class="work-card__summary">{{ props.work.summary }}</p>

      <div class="row small dim" style="gap: 6px">
        <span v-if="props.showEvent" class="tag">{{ catalog.eventTitle(props.work.eventId) }}</span>
        <span v-for="tag in (props.work.tags ?? []).slice(0, 2)" :key="tag" class="tag">{{ tag }}</span>
      </div>

      <div class="work-card__author">
        <img v-if="avatar" :src="avatar" alt="" />
        <span>{{ props.work.author.login }}</span>
        <span class="spacer"></span>
        <span class="dim">{{ formatDate(props.work.createdAt) }}</span>
      </div>
    </div>
  </router-link>
</template>
