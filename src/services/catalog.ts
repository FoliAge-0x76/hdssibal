import type { EventItem, SiteConfig, Work } from '@/types'

/**
 * 站点的“读”路径：把仓库里的 data/ 目录在构建时打包进产物。
 * 好处是访客不需要任何 API 调用（不会撞速率限制），页面秒开；
 * 代价是提交后要等 GitHub Actions 重新构建（约 30 秒）才会对公众可见。
 * 本人刚提交的内容由 services/works.ts 直接读仓库接口补齐，见 stores/catalog.ts。
 */
const workModules = import.meta.glob<Work>('/data/works/*.json', { eager: true, import: 'default' })
const eventModules = import.meta.glob<EventItem>('/data/events/*.json', { eager: true, import: 'default' })
const configModules = import.meta.glob<SiteConfig>('/data/config.json', { eager: true, import: 'default' })

export const fallbackConfig: SiteConfig = {
  site: {
    name: '在线比赛会场',
    tagline: '用 GitHub 账号登录，提交并展示你的作品',
  },
  admins: [],
  activityLimit: 12,
}

function collect<T>(modules: Record<string, T>): T[] {
  return Object.values(modules).filter((value): value is T => Boolean(value) && typeof value === 'object')
}

export function loadConfig(): SiteConfig {
  const [config] = collect(configModules)
  if (!config) return fallbackConfig
  return {
    ...fallbackConfig,
    ...config,
    site: { ...fallbackConfig.site, ...config.site },
    admins: Array.isArray(config.admins) ? config.admins : [],
    activityLimit: config.activityLimit ?? fallbackConfig.activityLimit,
  }
}

export function loadWorks(): Work[] {
  return collect(workModules).sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
}

export function loadEvents(): EventItem[] {
  return collect(eventModules).sort((a, b) => {
    const left = a.startAt || a.createdAt || ''
    const right = b.startAt || b.createdAt || ''
    return right.localeCompare(left)
  })
}
