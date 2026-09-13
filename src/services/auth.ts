import { oauthClientId, oauthScopes } from '@/config'

/**
 * GitHub 登录。提供两条互不依赖的路径：
 *
 * 1. 设备码（Device Flow）——只需要 OAuth App 的 Client ID，不需要 client secret，
 *    也不需要任何自建后端。为了让浏览器把它当成“简单请求”（不触发 CORS 预检），
 *    这里刻意只使用 form-urlencoded 正文和 CORS 安全列表内的请求头。
 * 2. 访问令牌（PAT）——用户自己粘贴 fine-grained / classic token。
 *    走 api.github.com，该域名完整支持 CORS，任何环境下都可用。
 *
 * 注意：GitHub 的登录端点不响应 OPTIONS 预检请求，因此设备码方案在部分浏览器/网络
 * 环境下可能被 CORS 拦截；此时界面会引导用户改用访问令牌。
 * 详见 docs/SETUP.md 的“登录方案对比”。
 */

const DEVICE_CODE_URL = 'https://github.com/login/device/code'
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token'

export interface DeviceFlowStart {
  deviceCode: string
  userCode: string
  verificationUri: string
  expiresIn: number
  interval: number
}

export class AuthError extends Error {
  readonly detail?: unknown

  constructor(message: string, detail?: unknown) {
    super(message)
    this.name = 'AuthError'
    this.detail = detail
  }
}

async function oauthPost(url: string, params: Record<string, string>): Promise<any> {
  const response = await fetch(url, {
    method: 'POST',
    // 只使用预检安全列表内的头，避免 OPTIONS 预检
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams(params).toString(),
  }).catch((error) => {
    throw new AuthError(
      '无法访问 GitHub 登录端点：请求被浏览器或网络拦截（CORS）。请改用“访问令牌”方式登录。',
      error,
    )
  })

  const text = await response.text()
  if (!response.ok) {
    throw new AuthError(`GitHub 登录端点返回 HTTP ${response.status}。请改用“访问令牌”方式登录。`, text)
  }
  try {
    return JSON.parse(text)
  } catch {
    // 默认返回的是 form-urlencoded，兼容一下
    return Object.fromEntries(new URLSearchParams(text))
  }
}

/** 第 1 步：申请设备码与用户码。 */
export async function startDeviceFlow(): Promise<DeviceFlowStart> {
  if (!oauthClientId) {
    throw new AuthError('尚未配置 OAuth App 的 Client ID，无法使用设备码登录。')
  }
  const payload = await oauthPost(DEVICE_CODE_URL, {
    client_id: oauthClientId,
    scope: oauthScopes,
  })
  if (payload.error) {
    throw new AuthError(`申请设备码失败：${payload.error_description ?? payload.error}`)
  }
  return {
    deviceCode: payload.device_code,
    userCode: payload.user_code,
    verificationUri: payload.verification_uri,
    expiresIn: Number(payload.expires_in ?? 900),
    interval: Number(payload.interval ?? 5),
  }
}

export type DevicePollResult =
  | { status: 'pending' }
  | { status: 'slow_down'; interval: number }
  | { status: 'token'; token: string }

/** 第 2 步：轮询换取访问令牌。 */
export async function pollDeviceFlow(deviceCode: string): Promise<DevicePollResult> {
  const payload = await oauthPost(ACCESS_TOKEN_URL, {
    client_id: oauthClientId,
    device_code: deviceCode,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
  })

  if (payload.access_token) return { status: 'token', token: payload.access_token as string }

  switch (payload.error) {
    case 'authorization_pending':
      return { status: 'pending' }
    case 'slow_down':
      return { status: 'slow_down', interval: Number(payload.interval ?? 10) }
    case 'expired_token':
      throw new AuthError('设备码已过期，请重新开始登录。')
    case 'access_denied':
      throw new AuthError('你取消了授权。')
    default:
      throw new AuthError(`登录失败：${payload.error_description ?? payload.error ?? '未知错误'}`)
  }
}

export function describeMissingScope(scopes: string | null): string | null {
  if (!scopes) return null
  const granted = scopes.split(/[,\s]+/).filter(Boolean)
  if (!granted.length) return null
  const hasRepoAccess = granted.some((scope) => ['repo', 'public_repo', 'write:repo', 'contents'].includes(scope))
  return hasRepoAccess ? null : `当前令牌的权限为「${granted.join(', ')}」，需要可写仓库内容的权限（public_repo 或 Contents: Read and write）。`
}
