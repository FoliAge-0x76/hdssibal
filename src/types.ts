export interface AuthorRef {
  /** GitHub 登录名，作品的唯一归属依据。 */
  login: string
  id?: number | null
  name?: string | null
  avatarUrl?: string | null
}

export interface WorkLink {
  label: string
  url: string
}

/** 谱面来源：外部下载链接 + 曲目信息。 */
export interface ChartSource {
  /** 谱面下载链接（必填，只允许 http/https）。 */
  url: string
  /** 曲师。 */
  artist?: string
  /** 谱师。 */
  designer?: string
  /** BPM，保留原始写法，例如 "175" / "120-240"。 */
  bpm?: string
  /** 各难度等级，例如 ["Easy 3", "Master 12+"]。 */
  difficulties?: string[]
}

/** data/works/<id>.json */
export interface Work {
  id: string
  eventId: string
  title: string
  summary?: string
  /** Markdown 正文（渲染时不解析原始 HTML）。 */
  description?: string
  /** 相对 public/ 的封面路径，例如 works/abc/cover.png；也允许外部图片 URL。 */
  cover?: string
  /** 谱面下载链接与曲目信息。 */
  chart?: ChartSource
  tags?: string[]
  links?: WorkLink[]
  author: AuthorRef
  createdAt: string
  updatedAt: string
}

export type EventStatus = 'draft' | 'upcoming' | 'open' | 'closed' | 'archived'

/** data/events/<id>.json */
export interface EventItem {
  id: string
  title: string
  subtitle?: string
  description?: string
  cover?: string
  status: EventStatus
  startAt?: string
  endAt?: string
  /** 是否开放投稿。 */
  acceptSubmissions: boolean
  /** 创建者的 GitHub 登录名。 */
  createdBy?: string
  createdAt: string
  updatedAt: string
}

/** data/config.json */
export interface SiteConfig {
  site: {
    name: string
    tagline?: string
    description?: string
    /** 顶部导航显示的仓库链接，留空则自动生成。 */
    repoUrl?: string
  }
  /** 管理员登录名白名单（仓库 admin 权限的用户自动是管理员，此列表只是补充）。 */
  admins: string[]
  /** 首页“最近活动”显示的条数。 */
  activityLimit?: number
}

export type ActivityType = 'work.created' | 'work.updated' | 'event.created' | 'event.updated'

export interface ActivityItem {
  id: string
  type: ActivityType
  at: string
  actor: AuthorRef
  work?: Work
  event?: EventItem
}

export interface Identity {
  login: string
  id: number
  name: string | null
  avatarUrl: string | null
}
