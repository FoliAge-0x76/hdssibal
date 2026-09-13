import type { EventItem } from '@/types'

/** 判定活动是否「正在进行中」，参数取活动实体的子集，便于测试与复用。 */
export type EventWindowInput = Pick<EventItem, 'status' | 'acceptSubmissions' | 'startAt' | 'endAt'>

/**
 * 活动是否正在进行且接受投稿。
 *
 * 只有「状态为 open、接受投稿、且当前时间落在起止区间内」的活动才算进行中，
 * 未开始、已截止、草稿与归档活动都不允许投稿。
 */
export function isEventOngoing(event: EventWindowInput, now: number = Date.now()): boolean {
  if (event.status !== 'open') return false
  if (!event.acceptSubmissions) return false

  const start = event.startAt ? Date.parse(event.startAt) : Number.NaN
  if (Number.isFinite(start) && now < start) return false

  const end = event.endAt ? Date.parse(event.endAt) : Number.NaN
  if (Number.isFinite(end) && now > end) return false

  return true
}

/** 投稿截止提示文案，例如「剩余 12 天」。 */
export function remainingLabel(event: EventWindowInput, now: number = Date.now()): string {
  const end = event.endAt ? Date.parse(event.endAt) : Number.NaN
  if (!Number.isFinite(end)) return '长期开放'

  const remain = end - now
  if (remain <= 0) return '已截止'

  const minutes = Math.floor(remain / 60000)
  if (minutes < 60) return `剩余 ${Math.max(minutes, 1)} 分钟`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `剩余 ${hours} 小时`

  return `剩余 ${Math.floor(hours / 24)} 天`
}
