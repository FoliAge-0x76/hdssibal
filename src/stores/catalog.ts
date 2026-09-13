import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { loadConfig, loadEvents, loadWorks } from '@/services/catalog'
import type { EventItem, Work } from '@/types'
import { buildActivity } from '@/utils/activity'
import { isEventOngoing } from '@/utils/eventWindow'

export const useCatalogStore = defineStore('catalog', () => {
  const config = ref(loadConfig())
  const works = ref<Work[]>(loadWorks())
  const events = ref<EventItem[]>(loadEvents())

  const activityLimit = computed(() => config.value.activityLimit ?? 12)
  const activities = computed(() => buildActivity(works.value, events.value, activityLimit.value))

  const worksByEvent = computed(() => {
    const grouped = new Map<string, Work[]>()
    for (const work of works.value) {
      const list = grouped.get(work.eventId) ?? []
      list.push(work)
      grouped.set(work.eventId, list)
    }
    for (const list of grouped.values()) list.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    return grouped
  })

  function eventById(id: string): EventItem | undefined {
    return events.value.find((event) => event.id === id)
  }

  function workById(id: string): Work | undefined {
    return works.value.find((work) => work.id === id)
  }

  function worksOfEvent(id: string): Work[] {
    return worksByEvent.value.get(id) ?? []
  }

  function eventTitle(id: string): string {
    return eventById(id)?.title ?? id
  }

  /** 投稿入口默认选中的活动：第一个仍在进行中的活动。 */
  const defaultEvent = computed<EventItem | undefined>(() => {
    return events.value
      .filter((event) => isEventOngoing(event))
      .sort((a, b) => (a.startAt ?? '').localeCompare(b.startAt ?? ''))[0]
  })

  /** 用刚提交的作品补齐构建产物里还没有的数据。 */
  function mergeLiveWorks(live: Work[]): void {
    if (!live.length) return
    const merged = [...works.value]
    for (const work of live) {
      const index = merged.findIndex((item) => item.id === work.id)
      if (index >= 0) merged[index] = work
      else merged.unshift(work)
    }
    works.value = merged.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  return {
    config,
    works,
    events,
    activities,
    activityLimit,
    worksByEvent,
    eventById,
    workById,
    worksOfEvent,
    eventTitle,
    defaultEvent,
    mergeLiveWorks,
  }
})
