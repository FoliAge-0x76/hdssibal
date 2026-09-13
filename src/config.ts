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

/** GitHub OAuth App 的 Client ID；为空时只能使用访问令牌登录。 */
export const oauthClientId: string = import.meta.env.VITE_OAUTH_CLIENT_ID?.trim() ?? ''

export const oauthScopes: string = import.meta.env.VITE_OAUTH_SCOPES?.trim() || 'public_repo'

/**
 * OAuth 中转层地址（relay/ 目录里那份代码部署后拿到的域名）。
 * 因为 GitHub 的 token 端点不支持 CORS 预检、且必须携带 client_secret，
 * 授权码→令牌的交换只能由这个中转层来完成。
 */
export const oauthRelayUrl: string = (import.meta.env.VITE_OAUTH_RELAY_URL?.trim() ?? '').replace(
  /\/+$/,
  '',
)

/** 一键登录需要 Client ID 与中转层地址同时就位。 */
export const oauthEnabled: boolean = oauthClientId.length > 0 && oauthRelayUrl.length > 0

/**
 * OAuth 回调地址，必须与 OAuth App 里登记的 Authorization callback URL 完全一致。
 * 站点走 hash 路由，所以真实路径只会是 `/` 或 `/<repo>/`；这里顺手把
 * `/index.html` 归一化掉，避免用户从 index.html 进入时算出不一样的 redirect_uri。
 */
export function oauthRedirectUri(): string {
  if (typeof location === 'undefined') return ''
  const path = location.pathname.replace(/index\.html$/, '') || '/'
  return `${location.origin}${path}`
}

/** 把 data/ 里记录的相对路径转成可访问的 URL。 */
export function assetUrl(path?: string | null): string {
  if (!path) return ''
  if (/^(https?:)?\/\//i.test(path) || path.startsWith('data:')) return path
  const base = import.meta.env.BASE_URL || './'
  return `${base}${path.replace(/^\/+/, '')}`
}
