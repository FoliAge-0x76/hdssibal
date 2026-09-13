import type { ActivityItem, EventItem, Work } from '@/types'

/**
 * 首页“最近活动”。
 * 直接由 data/ 里的时间戳派生（不需要后端、也不需要额外抓取 GitHub 事件接口），
 * 因此构建产物里就带着完整活动流，访客零请求即可看到。
 */
export function buildActivity(works: Work[], events: EventItem[], limit = 12): ActivityItem[] {
  const items: ActivityItem[] = []

  for (const work of works) {
    const actor = work.author ?? { login: 'unknown' }
    items.push({
      id: `work-created-${work.id}`,
      type: 'work.created',
      at: work.createdAt,
      actor,
      work,
    })
    if (work.updatedAt && work.updatedAt !== work.createdAt) {
      items.push({
        id: `work-updated-${work.id}-${work.updatedAt}`,
        type: 'work.updated',
        at: work.updatedAt,
        actor,
        work,
      })
    }
  }

  for (const event of events) {
    const actor = { login: event.createdBy ?? 'admin' }
    items.push({
      id: `event-created-${event.id}`,
      type: 'event.created',
      at: event.createdAt,
      actor,
      event,
    })
    if (event.updatedAt && event.updatedAt !== event.createdAt) {
      items.push({
        id: `event-updated-${event.id}-${event.updatedAt}`,
        type: 'event.updated',
        at: event.updatedAt,
        actor,
        event,
      })
    }
  }

  return items
    .filter((item) => Boolean(item.at))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit)
}

export function describeActivity(item: ActivityItem): string {
  switch (item.type) {
    case 'work.created':
      return `提交了作品《${item.work?.title ?? ''}》`
    case 'work.updated':
      return `更新了作品《${item.work?.title ?? ''}》`
    case 'event.created':
      return `发布了活动「${item.event?.title ?? ''}」`
    case 'event.updated':
      return `调整了活动「${item.event?.title ?? ''}」`
    default:
      return '有新动态'
  }
}
