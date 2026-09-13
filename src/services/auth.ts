/**
 * GitHub 登录。提供两条互不依赖的路径：
 *
 * 1. **GitHub 一键登录**（OAuth 授权码流程）——推荐，实现参考 giscus。
 *    站点是纯静态的，而 GitHub 的 `login/oauth/access_token` 端点**不返回任何 CORS 响应头**，
 *    且**必须**携带 `client_secret`。所以「用授权码换令牌」交给自建的中转层完成
 *    （代码见 relay/ 目录）。跟 giscus 一样，中转层在 GitHub 那边只登记**一个固定回调地址**，
 *    「授权完成后要回到哪个站点」由中转层加密进 `state` 携带，
 *    所以同一个中转层可以同时服务生产站点、fork 和本地开发。
 *    详见 docs/SETUP.md 的「登录方案对比」。
 * 2. **访问令牌（PAT）**——兜底。用户自己粘贴 fine-grained / classic token，
 *    走 api.github.com，该域名完整支持 CORS，任何环境下都可用。
 *
 * 早期版本还实现过设备码（Device Flow）与 PKCE，前者同样要调用不带 CORS 头的
 * `github.com/login/*` 端点，实测在浏览器里不可用；后者在本流程里是多余的
 * （授权码由 GitHub 直接送到中转层，不经过浏览器 JS，且换令牌必须有 secret），
 * 两者均已移除。
 */

export class AuthError extends Error {
  readonly detail?: unknown

  constructor(message: string, detail?: unknown) {
    super(message)
    this.name = 'AuthError'
    this.detail = detail
  }
}

/**
 * 构造中转层的授权入口地址。参数用 encodeURIComponent 手工拼接，
 * 因为 URLSearchParams 会把 scope 里的空格编码成 `+`。
 */
export function buildRelayAuthorizeUrl(params: {
  relayUrl: string
  redirectUri: string
  state: string
  scope?: string
}): string {
  const base = `${params.relayUrl.replace(/\/+$/, '')}/api/oauth/authorize`
  const query: Record<string, string> = {
    redirect_uri: params.redirectUri,
    state: params.state,
    scope: params.scope ?? '',
  }
  const encoded = Object.entries(query)
    .filter(([, value]) => value !== '')
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&')
  return `${base}?${encoded}`
}

/** 把中转层返回的错误码翻译成用户看得懂的中文说明；无法识别时返回 null 交给调用方兜底。 */
function describeRelayError(code: string): string | null {
  switch (code) {
    case 'bad_verification_code':
      return '授权码无效或已过期（GitHub 授权码只有 10 分钟有效期），请重新登录。'
    case 'incorrect_client_credentials':
    case 'invalid_client':
    // GitHub 在 client_id 不存在时返回 404 + {"error":"Not Found"}，原因同样是凭据不对
    case 'Not Found':
    case 'server_not_configured':
      return '中转服务的 Client ID / Client Secret 配置不正确，请联系站点管理员（见 docs/SETUP.md 第 5 节）。'
    case 'redirect_uri_not_allowed':
    case 'forbidden_origin':
      return '中转服务拒绝了本站的来源，请检查中转层的 ALLOWED_ORIGINS 是否包含本站域名。'
    case 'insecure_redirect_uri':
    case 'invalid_redirect_uri':
      return '本站的回跳地址不被中转服务接受。请确认站点通过 https 访问，且域名在 ALLOWED_ORIGINS 里。'
    case 'invalid_state':
    case 'state_expired':
      return '登录状态校验失败或已超时（授权有效期 10 分钟），请重新登录。'
    case 'session_origin_mismatch':
      return '登录凭据不属于本站，请重新登录。'
    case 'upstream_unreachable':
      return '中转服务无法访问 GitHub，请稍后重试。'
    case 'missing_code':
    case 'missing_session':
    case 'redirect_uri_required':
    case 'invalid_request_body':
      return '登录请求不完整或格式不正确，请重新登录。'
    case 'method_not_allowed':
      return '中转服务拒绝了这次请求，请重新登录或改用访问令牌。'
    case 'not_found':
      return '中转服务版本过旧（没有 /api/oauth 接口），请更新 relay 部署后重试。'
    default:
      return null
  }
}

export interface TokenExchangeResult {
  token: string
  scopes: string | null
}

/**
 * 把 `session` 换成访问令牌。凭据只对本站点有效（中转层会核对来源），
 * 令牌本身全程不出现在地址栏里。
 */
export async function exchangeSessionForToken(params: {
  relayUrl: string
  session: string
}): Promise<TokenExchangeResult> {
  const endpoint = `${params.relayUrl.replace(/\/+$/, '')}/api/oauth/session`

  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session: params.session }),
    })
  } catch (error) {
    throw new AuthError('无法连接登录中转服务，请检查网络后重试。', error)
  }

  const text = await response.text()
  let payload: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(text) as unknown
    if (typeof parsed === 'object' && parsed !== null) payload = parsed as Record<string, unknown>
  } catch {
    payload = {}
  }

  const token = typeof payload.access_token === 'string' ? payload.access_token : ''
  if (!response.ok || !token) {
    const errorCode = typeof payload.error === 'string' ? payload.error : ''
    const description =
      typeof payload.error_description === 'string' ? payload.error_description : ''
    const fallback =
      description ||
      `登录中转服务返回了 HTTP ${response.status}${errorCode ? `（${errorCode}）` : ''}，请重试或改用访问令牌登录。`
    throw new AuthError(describeRelayError(errorCode) ?? fallback, payload)
  }

  return { token, scopes: typeof payload.scope === 'string' ? payload.scope : null }
}

/** 检查令牌实际拿到的权限是否覆盖投稿所需的仓库写权限。 */
export function describeMissingScope(scopes: string | null): string | null {
  if (!scopes) return null
  const granted = scopes.split(/[,\s]+/).filter(Boolean)
  if (!granted.length) return null
  const hasRepoAccess = granted.some((scope) =>
    ['repo', 'public_repo', 'write:repo', 'contents'].includes(scope),
  )
  return hasRepoAccess
    ? null
    : `当前令牌的权限为「${granted.join(', ')}」，需要可写仓库内容的权限（public_repo 或 Contents: Read and write）。`
}
