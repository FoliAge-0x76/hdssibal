import type { EventItem, EventStatus, Identity, Work } from '@/types'
import { slugify } from '@/utils/format'
import type { PreparedImage } from './images'
import { GitHubError, listDirectory, putBase64File, readJsonFile, removeFile, writeFile } from './github'

export interface EventDraft {
  title: string
  subtitle: string
  description: string
  status: EventStatus
  startAt: string
  endAt: string
  acceptSubmissions: boolean
}

export interface SaveEventOptions {
  token: string
  actor: Identity
  existing?: EventItem | null
  cover?: PreparedImage | null
  removeCover?: boolean
}

export const EVENT_STATUS_LABELS: Record<EventStatus, string> = {
  draft: '草稿',
  upcoming: '即将开始',
  open: '征集中',
  closed: '已截止',
  archived: '已归档',
}

export function eventDataPath(id: string): string {
  return `data/events/${id}.json`
}

function buildEventId(title: string, startAt: string): string {
  const year = startAt ? new Date(startAt).getFullYear() : new Date().getFullYear()
  return `${year}-${slugify(title, 30)}`
}

async function removeCoverFiles(token: string, eventId: string): Promise<void> {
  const entries = await listDirectory(token, `public/events/${eventId}`)
  for (const entry of entries) {
    if (entry.type !== 'file') continue
    await removeFile(entry.path, { token, sha: entry.sha, message: `chore(event): 清理「${eventId}」的旧封面` })
  }
}

export async function saveEvent(draft: EventDraft, options: SaveEventOptions): Promise<EventItem> {
  const { token, actor, existing, cover, removeCover = false } = options
  if (!draft.title.trim()) throw new Error('请填写活动名称。')

  const now = new Date().toISOString()
  const id = existing?.id ?? buildEventId(draft.title, draft.startAt)
  const previousCover = existing?.cover ?? undefined
  let nextCover = removeCover ? undefined : previousCover

  if (cover) {
    const path = `public/events/${id}/cover.${cover.extension}`
    await putBase64File(path, cover.base64, {
      token,
      message: `feat(event): 上传活动「${draft.title.trim()}」的封面`,
    })
    nextCover = `events/${id}/cover.${cover.extension}`
  }

  const event: EventItem = {
    id,
    title: draft.title.trim(),
    subtitle: draft.subtitle.trim(),
    description: draft.description,
    status: draft.status,
    startAt: draft.startAt,
    endAt: draft.endAt,
    acceptSubmissions: draft.acceptSubmissions,
    cover: nextCover,
    createdBy: existing?.createdBy ?? actor.login,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }

  if (!event.subtitle) delete event.subtitle
  if (!event.description) delete event.description
  if (!event.cover) delete event.cover
  if (!event.startAt) delete event.startAt
  if (!event.endAt) delete event.endAt

  const current = existing ? await readJsonFile<EventItem>(token, eventDataPath(id)) : null
  await writeFile(eventDataPath(id), `${JSON.stringify(event, null, 2)}\n`, {
    token,
    sha: current?.sha,
    message: existing ? `feat(event): 更新活动「${event.title}」` : `feat(event): 创建活动「${event.title}」`,
  })

  if (previousCover && previousCover !== nextCover && previousCover.startsWith('events/')) {
    await removeCoverFiles(token, id).catch(() => undefined)
  }

  return event
}

/** 删除活动。默认拒绝删除仍有作品的活动，避免作品挂在空活动下。 */
export async function deleteEvent(event: EventItem, token: string, force = false): Promise<void> {
  if (!force) {
    const entries = await listDirectory(token, 'data/works')
    for (const entry of entries) {
      if (entry.type !== 'file' || !entry.name.endsWith('.json')) continue
      const parsed = await readJsonFile<Work>(token, entry.path)
      if (parsed?.data.eventId === event.id) {
        throw new GitHubError(409, `活动「${event.title}」下仍有作品，请先移除这些作品或选择强制删除。`)
      }
    }
  }

  const file = await readJsonFile<EventItem>(token, eventDataPath(event.id))
  if (!file) throw new GitHubError(404, '该活动已经不存在了。')
  await removeFile(eventDataPath(event.id), {
    token,
    sha: file.sha,
    message: `chore(event): 删除活动「${event.title}」`,
  })
  await removeCoverFiles(token, event.id).catch(() => undefined)
}
