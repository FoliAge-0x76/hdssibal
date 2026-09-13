import type { ChartSource, Identity, Work, WorkLink } from '@/types'
import { randomSuffix, slugify } from '@/utils/format'
import { describeUrlProblem, normalizeHttpUrl } from '@/utils/url'
import type { PreparedImage } from './images'
import { GitHubError, listDirectory, putBase64File, readJsonFile, removeFile, writeFile } from './github'

export interface WorkDraft {
  eventId: string
  title: string
  summary: string
  description: string
  tags: string[]
  links: WorkLink[]
  /** 谱面下载链接（必填）。 */
  chartUrl: string
  /** 曲师。 */
  chartArtist: string
  /** 谱师。 */
  chartDesigner: string
  /** BPM。 */
  chartBpm: string
  /** 难度等级，用逗号或斜杠分隔。 */
  chartDifficulties: string
}

export interface SaveWorkOptions {
  token: string
  actor: Identity
  /** 传入则为更新，留空为新建。 */
  existing?: Work | null
  cover?: PreparedImage | null
  /** 传入表示要移除现有封面。 */
  removeCover?: boolean
}

export function workDataPath(id: string): string {
  return `data/works/${id}.json`
}

function coverRepoPath(id: string, extension: string): string {
  return `public/works/${id}/cover.${extension}`
}

function coverRelativePath(id: string, extension: string): string {
  return `works/${id}/cover.${extension}`
}

function buildWorkId(title: string): string {
  return `${slugify(title)}-${randomSuffix()}`
}

function normalizeLinks(links: WorkLink[]): WorkLink[] {
  return links
    .map((link) => ({ label: link.label.trim(), url: link.url.trim() }))
    .filter((link) => link.url.length > 0)
    .map((link, index) => {
      const url = normalizeHttpUrl(link.url)
      if (!url) {
        throw new Error(`第 ${index + 1} 个附加链接无效：${describeUrlProblem(link.url)}`)
      }
      return { label: link.label, url }
    })
}

function normalizeTags(tags: string[]): string[] {
  return Array.from(new Set(tags.map((tag) => tag.trim()).filter(Boolean)))
}

/** 按逗号 / 顿号 / 斜杠拆分多值输入，用于难度等级。 */
function splitList(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[,，、/|]+/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  )
}

function buildChart(draft: WorkDraft): ChartSource {
  const url = normalizeHttpUrl(draft.chartUrl)
  if (!url) {
    throw new Error(describeUrlProblem(draft.chartUrl) ?? '请填写有效的谱面下载链接。')
  }

  const chart: ChartSource = { url }

  const artist = draft.chartArtist.trim()
  if (artist) chart.artist = artist

  const designer = draft.chartDesigner.trim()
  if (designer) chart.designer = designer

  const bpm = draft.chartBpm.trim()
  if (bpm) chart.bpm = bpm

  const difficulties = splitList(draft.chartDifficulties)
  if (difficulties.length) chart.difficulties = difficulties

  return chart
}

/** 删除某个作品目录下的所有封面文件，避免留下孤儿文件。 */
async function removeCoverFiles(token: string, workId: string): Promise<void> {
  const entries = await listDirectory(token, `public/works/${workId}`)
  for (const entry of entries) {
    if (entry.type !== 'file') continue
    await removeFile(entry.path, {
      token,
      sha: entry.sha,
      message: `chore(work): 清理《${workId}》的旧封面`,
    })
  }
}

export async function saveWork(draft: WorkDraft, options: SaveWorkOptions): Promise<Work> {
  const { token, actor, existing, cover, removeCover = false } = options
  if (!draft.title.trim()) throw new Error('请填写作品标题。')
  if (!draft.eventId) throw new Error('请选择一个正在进行的活动。')

  const previousCover = existing?.cover ?? undefined
  // 先做完全部校验与序列化，避免校验失败时已经往仓库写了半成品
  const chart = buildChart(draft)
  const links = normalizeLinks(draft.links)
  if (!cover && (!previousCover || removeCover)) throw new Error('请上传一张封面图。')

  const now = new Date().toISOString()
  const id = existing?.id ?? buildWorkId(draft.title)

  let nextCover = removeCover ? undefined : previousCover

  if (cover) {
    const path = coverRepoPath(id, cover.extension)
    await putBase64File(path, cover.base64, {
      token,
      message: `feat(work): 上传《${draft.title.trim()}》的封面`,
    })
    nextCover = coverRelativePath(id, cover.extension)
  }

  const work: Work = {
    id,
    eventId: draft.eventId,
    title: draft.title.trim(),
    summary: draft.summary.trim(),
    description: draft.description,
    tags: normalizeTags(draft.tags),
    links,
    cover: nextCover,
    chart,
    author: existing?.author ?? {
      login: actor.login,
      id: actor.id,
      name: actor.name,
      avatarUrl: actor.avatarUrl,
    },
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }

  if (!work.summary) delete work.summary
  if (!work.description) delete work.description
  if (!work.cover) delete work.cover
  if (!work.tags?.length) delete work.tags
  if (!work.links?.length) delete work.links

  const current = existing ? await readJsonFile<Work>(token, workDataPath(id)) : null
  await writeFile(workDataPath(id), `${JSON.stringify(work, null, 2)}\n`, {
    token,
    sha: current?.sha,
    message: existing
      ? `feat(work): 更新作品《${work.title}》`
      : `feat(work): 提交作品《${work.title}》`,
  })

  // 封面换了后缀或明确移除时，旧文件要清掉
  if (previousCover && previousCover !== nextCover && previousCover.startsWith('works/')) {
    await removeCoverFiles(token, id).catch(() => undefined)
  }

  return work
}

export async function deleteWork(work: Work, token: string): Promise<void> {
  const file = await readJsonFile<Work>(token, workDataPath(work.id))
  if (!file) throw new GitHubError(404, '该作品已经不存在了，可能刚被删除。')
  await removeFile(workDataPath(work.id), {
    token,
    sha: file.sha,
    message: `chore(work): 删除作品《${work.title}》`,
  })
  await removeCoverFiles(token, work.id).catch(() => undefined)
}

/** 读取作品当前内容与 sha，用于编辑表单（拿到最新的更新时间和版本号）。 */
export async function fetchWork(token: string, id: string): Promise<{ work: Work; sha: string } | null> {
  const file = await readJsonFile<Work>(token, workDataPath(id))
  return file ? { work: file.data, sha: file.sha } : null
}

/** 直接查仓库，列出某个人的全部作品（比等待重新构建更快看到刚提交的内容）。 */
export async function fetchWorksByAuthor(token: string, login: string): Promise<Work[]> {
  const entries = await listDirectory(token, 'data/works')
  const files = entries.filter((entry) => entry.type === 'file' && entry.name.endsWith('.json'))
  const works: Work[] = []
  for (const entry of files) {
    const parsed = await readJsonFile<Work>(token, entry.path)
    if (parsed?.data?.author?.login?.toLowerCase() === login.toLowerCase()) works.push(parsed.data)
  }
  return works.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}
