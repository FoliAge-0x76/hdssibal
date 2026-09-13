import { repoRef } from '@/config'
import type { Identity } from '@/types'
import { base64ToUtf8, utf8ToBase64 } from '@/utils/encoding'

const API_BASE = 'https://api.github.com'

export class GitHubError extends Error {
  readonly status: number
  readonly detail?: unknown

  constructor(status: number, message: string, detail?: unknown) {
    super(message)
    this.name = 'GitHubError'
    this.status = status
    this.detail = detail
  }
}

interface RequestOptions {
  token?: string | null
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  signal?: AbortSignal
}

function describeError(status: number, payload: any, response: Response): string {
  const apiMessage: string = payload?.message ?? ''
  switch (status) {
    case 401:
      return '登录已失效或访问令牌无效，请重新登录。'
    case 403: {
      const remaining = response.headers.get('x-ratelimit-remaining')
      if (remaining === '0') {
        const reset = Number(response.headers.get('x-ratelimit-reset') ?? 0) * 1000
        const at = reset ? new Date(reset).toLocaleTimeString('zh-CN') : '稍后'
        return `已触发 GitHub API 速率限制，请于 ${at} 之后重试。`
      }
      return `没有执行该操作的权限：${apiMessage || '请确认你的账号已被授予仓库写入权限。'}`
    }
    case 404:
      return `资源不存在或你没有访问权限：${apiMessage || '请检查仓库坐标与账号权限。'}`
    case 409:
    case 422:
      return `提交冲突，可能有人刚刚修改了同一份数据，请刷新后重试。${apiMessage ? `（${apiMessage}）` : ''}`
    default:
      return apiMessage || `GitHub 请求失败（HTTP ${status}）`
  }
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { token, method = 'GET', body, signal } = options
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  })

  if (!response.ok) {
    let payload: any = null
    try {
      payload = await response.json()
    } catch {
      payload = null
    }
    throw new GitHubError(response.status, describeError(response.status, payload, response), payload)
  }

  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

/** GET /user */
export async function fetchIdentity(token: string): Promise<Identity> {
  const user = await apiRequest<{ login: string; id: number; name: string | null; avatar_url: string | null }>(
    '/user',
    { token },
  )
  return { login: user.login, id: user.id, name: user.name, avatarUrl: user.avatar_url }
}

export interface RepoAccess {
  admin: boolean
  push: boolean
  canRead: boolean
}

/** GET /repos/{owner}/{repo} —— 用来判断当前账号是否为仓库管理员。 */
export async function fetchRepoAccess(token: string | null): Promise<RepoAccess> {
  const repository = await apiRequest<{
    permissions?: { admin?: boolean; push?: boolean; pull?: boolean }
  }>(`/repos/${repoRef.owner}/${repoRef.repo}`, { token })
  const permissions = repository.permissions ?? {}
  return {
    admin: Boolean(permissions.admin),
    push: Boolean(permissions.push || permissions.admin),
    canRead: Boolean(permissions.pull ?? true),
  }
}

/* -------------------------------------------------------------------------- */
/* Contents API：把仓库 data/ 与 public/works/ 当成数据库来读写                    */
/* -------------------------------------------------------------------------- */

export interface RepoDirEntry {
  type: 'file' | 'dir' | 'symlink' | 'submodule'
  name: string
  path: string
  sha: string
  size: number
}

interface RepoFilePayload {
  type: 'file'
  name: string
  path: string
  sha: string
  size: number
  content: string
  encoding: string
}

function encodePath(path: string): string {
  return path
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

function contentsUrl(path: string, ref?: string): string {
  const base = `/repos/${repoRef.owner}/${repoRef.repo}/contents/${encodePath(path)}`
  return ref ? `${base}?ref=${encodeURIComponent(ref)}` : base
}

/** 读取单个文件，返回解码后的文本与 sha（sha 是更新/删除时必须回传的版本号）。 */
export async function readFile(
  token: string | null,
  path: string,
  ref: string = repoRef.branch,
): Promise<{ content: string; sha: string } | null> {
  try {
    const payload = await apiRequest<RepoFilePayload>(contentsUrl(path, ref), { token })
    return { content: base64ToUtf8(payload.content ?? ''), sha: payload.sha }
  } catch (error) {
    if (error instanceof GitHubError && error.status === 404) return null
    throw error
  }
}

/** 读取并解析 JSON 文件。 */
export async function readJsonFile<T>(
  token: string | null,
  path: string,
  ref: string = repoRef.branch,
): Promise<{ data: T; sha: string } | null> {
  const file = await readFile(token, path, ref)
  if (!file) return null
  try {
    return { data: JSON.parse(file.content) as T, sha: file.sha }
  } catch {
    throw new GitHubError(500, `数据文件 ${path} 不是合法 JSON，请检查仓库内容。`)
  }
}

/** 列目录；目录不存在时返回空数组。 */
export async function listDirectory(
  token: string | null,
  path: string,
  ref: string = repoRef.branch,
): Promise<RepoDirEntry[]> {
  try {
    const payload = await apiRequest<RepoDirEntry[] | RepoFilePayload>(contentsUrl(path, ref), { token })
    return Array.isArray(payload) ? payload : [payload]
  } catch (error) {
    if (error instanceof GitHubError && error.status === 404) return []
    throw error
  }
}

export interface WriteOptions {
  message: string
  /** 更新已有文件时必填。 */
  sha?: string
  branch?: string
  token: string
}

/** 写入/更新单个文件（文本走 UTF-8 → base64）。 */
export async function writeFile(path: string, content: string, options: WriteOptions): Promise<{ sha: string }> {
  return putBase64File(path, utf8ToBase64(content), options)
}

/** 写入/更新单个二进制文件（图片等）。 */
export async function putBase64File(
  path: string,
  base64Content: string,
  options: WriteOptions,
): Promise<{ sha: string }> {
  const { message, sha, branch = repoRef.branch, token } = options
  const result = await apiRequest<{ content: { sha: string } }>(contentsUrl(path), {
    token,
    method: 'PUT',
    body: { message, content: base64Content, sha, branch },
  })
  return { sha: result.content.sha }
}

/** 删除文件。 */
export async function removeFile(path: string, options: WriteOptions & { sha: string }): Promise<void> {
  const { message, sha, branch = repoRef.branch, token } = options
  await apiRequest<unknown>(contentsUrl(path), {
    token,
    method: 'DELETE',
    body: { message, sha, branch },
  })
}
