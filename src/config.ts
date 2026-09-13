/**
 * 站点级配置。仓库坐标优先从环境变量读取；
 * 部署在 GitHub Pages 上时可以直接从域名/路径推断，所以通常无需任何配置。
 */
export interface RepoRef {
  owner: string
  repo: string
  branch: string
}

const PLACEHOLDER_OWNER = 'YOUR_GITHUB_USERNAME'
const PLACEHOLDER_REPO = 'YOUR_REPO_NAME'

function detectFromPagesHost(): { owner: string; repo: string } | null {
  if (typeof location === 'undefined') return null
  const host = location.hostname
  if (!host.endsWith('.github.io')) return null
  const owner = host.slice(0, -'.github.io'.length)
  if (!owner) return null
  const firstSegment = location.pathname.split('/').filter(Boolean)[0]
  // 形如 <user>.github.io 的用户主页仓库，路径里没有仓库名
  return { owner, repo: firstSegment ?? `${owner}.github.io` }
}

function resolveRepoRef(): RepoRef {
  const detected = detectFromPagesHost()
  const owner = import.meta.env.VITE_GITHUB_OWNER?.trim() || detected?.owner || PLACEHOLDER_OWNER
  const repo = import.meta.env.VITE_GITHUB_REPO?.trim() || detected?.repo || PLACEHOLDER_REPO
  const branch = import.meta.env.VITE_GITHUB_BRANCH?.trim() || 'main'
  return { owner, repo, branch }
}

export const repoRef: RepoRef = resolveRepoRef()

/** 仓库坐标是否已正确配置（否则页面会给出明确提示）。 */
export const isRepoConfigured: boolean =
  repoRef.owner !== PLACEHOLDER_OWNER && repoRef.repo !== PLACEHOLDER_REPO

export const repoWebUrl: string = `https://github.com/${repoRef.owner}/${repoRef.repo}`

/** 仅用于「访问令牌登录」页面上那个预填权限的创建链接，一键登录不再用到它。 */
export const oauthScopes: string = import.meta.env.VITE_OAUTH_SCOPES?.trim() || 'public_repo'

/**
 * OAuth 中转层地址（relay/ 目录里那份代码部署后拿到的域名）。
 *
 * Client ID / Client Secret 都只存在于中转层，站点这边不需要知道：
 * GitHub 的 token 端点不支持 CORS 预检、且必须携带 client_secret，
 * 所以「把授权结果换成令牌」只能由中转层完成。
 */
export const oauthRelayUrl: string = (import.meta.env.VITE_OAUTH_RELAY_URL?.trim() ?? '').replace(
  /\/+$/,
  '',
)

/** 一键登录只需要中转层地址就位。 */
export const oauthEnabled: boolean = oauthRelayUrl.length > 0

/**
 * 本站用来接收授权结果的静态页地址。
 *
 * 站点走 hash 路由，所以 `location.pathname` 只可能是 `/`、`/<repo>/` 或 `/index.html`；
 * 这里统一归一化成站点目录，再拼上 `oauth/callback.html`。
 * 该页面把结果 postMessage 给弹出的窗口（或整页回落时带着 query 跳回首页）。
 */
export function oauthReturnUrl(): string {
  if (typeof location === 'undefined') return ''
  const directory = location.pathname.replace(/index\.html$/, '').replace(/[^/]*$/, '')
  return `${location.origin}${directory}oauth/callback.html`
}

/** 把 data/ 里记录的相对路径转成可访问的 URL。 */
export function assetUrl(path?: string | null): string {
  if (!path) return ''
  if (/^(https?:)?\/\//i.test(path) || path.startsWith('data:')) return path
  const base = import.meta.env.BASE_URL || './'
  return `${base}${path.replace(/^\/+/, '')}`
}
