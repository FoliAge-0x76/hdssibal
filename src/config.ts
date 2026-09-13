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

export const deviceFlowEnabled: boolean = oauthClientId.length > 0

/** 把 data/ 里记录的相对路径转成可访问的 URL。 */
export function assetUrl(path?: string | null): string {
  if (!path) return ''
  if (/^(https?:)?\/\//i.test(path) || path.startsWith('data:')) return path
  const base = import.meta.env.BASE_URL || './'
  return `${base}${path.replace(/^\/+/, '')}`
}
