/**
 * data/ 目录的结构校验。零依赖，直接用 node 运行，方便在 CI 里挡住手写 JSON 的常见错误。
 * 用法：node scripts/validate-data.mjs
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = join(root, 'data')
const publicDir = join(root, 'public')

const EVENT_STATUSES = ['draft', 'upcoming', 'open', 'closed', 'archived']

const problems = []

function fail(file, message) {
  problems.push(`${file}: ${message}`)
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    fail(file, `不是合法 JSON（${error.message}）`)
    return null
  }
}

function listJson(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((name) => name.endsWith('.json'))
}

function isIsoDate(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
}

function checkAsset(file, assetPath) {
  if (!assetPath) return
  if (/^(https?:)?\/\//i.test(assetPath)) return
  if (!existsSync(join(publicDir, assetPath.replace(/^\/+/, '')))) {
    fail(file, `封面文件不存在：public/${assetPath.replace(/^\/+/, '')}`)
  }
}

/* ------------------------------------------------------------------ config */

const configFile = join(dataDir, 'config.json')
if (!existsSync(configFile)) {
  fail('data/config.json', '缺少站点配置文件')
} else {
  const config = readJson(configFile)
  if (config) {
    if (!config.site || typeof config.site.name !== 'string' || !config.site.name.trim()) {
      fail('data/config.json', 'site.name 必须是非空字符串')
    }
    if (config.admins !== undefined && !Array.isArray(config.admins)) {
      fail('data/config.json', 'admins 必须是字符串数组')
    }
    if (config.activityLimit !== undefined && (!Number.isInteger(config.activityLimit) || config.activityLimit < 1)) {
      fail('data/config.json', 'activityLimit 必须是正整数')
    }
  }
}

/* ------------------------------------------------------------------ events */

const eventIds = new Set()
for (const name of listJson(join(dataDir, 'events'))) {
  const file = `data/events/${name}`
  const event = readJson(join(dataDir, 'events', name))
  if (!event) continue

  const expectedId = name.replace(/\.json$/, '')
  if (event.id !== expectedId) fail(file, `id 必须与文件名一致（期望 "${expectedId}"）`)
  if (typeof event.title !== 'string' || !event.title.trim()) fail(file, 'title 必须是非空字符串')
  if (!EVENT_STATUSES.includes(event.status)) {
    fail(file, `status 必须是 ${EVENT_STATUSES.join(' / ')} 之一`)
  }
  if (typeof event.acceptSubmissions !== 'boolean') fail(file, 'acceptSubmissions 必须是布尔值')
  if (!isIsoDate(event.createdAt)) fail(file, 'createdAt 必须是 ISO 时间字符串')
  if (!isIsoDate(event.updatedAt)) fail(file, 'updatedAt 必须是 ISO 时间字符串')
  if (event.startAt !== undefined && !isIsoDate(event.startAt)) fail(file, 'startAt 必须是 ISO 时间字符串')
  if (event.endAt !== undefined && !isIsoDate(event.endAt)) fail(file, 'endAt 必须是 ISO 时间字符串')
  if (isIsoDate(event.startAt) && isIsoDate(event.endAt) && Date.parse(event.endAt) < Date.parse(event.startAt)) {
    fail(file, 'endAt 不能早于 startAt')
  }
  checkAsset(file, event.cover)
  eventIds.add(event.id)
}

/* ------------------------------------------------------------------- works */

const seenWorkIds = new Set()
for (const name of listJson(join(dataDir, 'works'))) {
  const file = `data/works/${name}`
  const work = readJson(join(dataDir, 'works', name))
  if (!work) continue

  const expectedId = name.replace(/\.json$/, '')
  if (work.id !== expectedId) fail(file, `id 必须与文件名一致（期望 "${expectedId}"）`)
  if (seenWorkIds.has(work.id)) fail(file, `作品 id 重复：${work.id}`)
  seenWorkIds.add(work.id)

  if (typeof work.title !== 'string' || !work.title.trim()) fail(file, 'title 必须是非空字符串')
  if (typeof work.eventId !== 'string' || !work.eventId.trim()) {
    fail(file, 'eventId 必须是非空字符串')
  } else if (!eventIds.has(work.eventId)) {
    fail(file, `eventId "${work.eventId}" 找不到对应活动`)
  }
  if (!work.author || typeof work.author.login !== 'string' || !work.author.login.trim()) {
    fail(file, 'author.login 必须是非空字符串')
  }
  if (!isIsoDate(work.createdAt)) fail(file, 'createdAt 必须是 ISO 时间字符串')
  if (!isIsoDate(work.updatedAt)) fail(file, 'updatedAt 必须是 ISO 时间字符串')
  if (work.tags !== undefined && !Array.isArray(work.tags)) fail(file, 'tags 必须是数组')
  if (work.links !== undefined) {
    if (!Array.isArray(work.links)) {
      fail(file, 'links 必须是数组')
    } else {
      work.links.forEach((link, index) => {
        if (!link || typeof link.url !== 'string' || !link.url.trim()) {
          fail(file, `links[${index}].url 必须是非空字符串`)
        }
      })
    }
  }
  checkAsset(file, work.cover)

  if (work.cover && !/^(https?:)?\/\//i.test(work.cover)) {
    const expectedPrefix = `works/${work.id}/`
    if (!work.cover.replace(/^\/+/, '').startsWith(expectedPrefix)) {
      fail(file, `本地封面路径应位于 public/${expectedPrefix} 下，当前为 "${work.cover}"`)
    }
  }
}

/* ------------------------------------------------------------------ report */

if (problems.length) {
  console.error(`✗ data/ 校验失败，共 ${problems.length} 个问题：\n`)
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}

console.log(`✓ data/ 校验通过：${eventIds.size} 个活动，${seenWorkIds.size} 件作品。`)
