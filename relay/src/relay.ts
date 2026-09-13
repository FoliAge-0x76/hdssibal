/**
 * GitHub OAuth 中转层（参考 giscus 的实现）。
 *
 * 为什么需要它：GitHub 的 `https://github.com/login/oauth/access_token` 端点
 * 不返回任何 CORS 响应头，且 `client_secret` 是必填参数（PKCE 不能替代）。
 * 纯静态站点既读不到响应，也不能把 secret 放进前端产物，所以必须有一个
 * 自己掌控的中间层来持有 secret 并完成 code → token 的交换。
 *
 * 与 giscus 一致的三个设计点：
 *   1. GitHub 侧只注册 **一个固定回调** `<relay>/api/oauth/authorized`；
 *      站点自己的返回地址由中转层加密成 `state` 一并带走。因此同一个
 *      OAuth App 可以同时服务生产域名、预览部署、fork 和本地开发，
 *      无需为每个来源单独登记回调地址。
 *   2. 中转层不做任何会话管理：它把令牌重新封成一段加密串（session），
 *      302 交回站点；站点再用这个 session 来 POST 换取明文令牌。
 *   3. 不使用 PKCE：授权码由 GitHub 直接 302 到中转层，从不经过浏览器 JS，
 *      而换取令牌又必须提供 client_secret，PKCE 在这里是纯冗余。
 *
 * 安全边界（重要）：**`redirect_uri` 的来源白名单**。
 * `state` 是加密信封，攻击者无法把它改成自己的地址；但如果这里不校验
 * 来源，任何人都能用 `?redirect_uri=https://evil.example/` 让中转层把
 * 别人的访问令牌直接送到自己手上。所以 ALLOWED_ORIGINS 就是唯一的闸门。
 *
 * 这一份代码同时适用于 **Deno Deploy** 和 **Cloudflare Workers**：
 * 两者都使用 Web 标准 API，入口都是 `export default { fetch }`。
 * 环境变量的读取做了兼容（Deno 走 Deno.env，Workers 走 fetch 的第二个参数）。
 *
 * 接口：
 *   OPTIONS *                     预检，返回 204 + CORS 头
 *   GET     /                     服务说明
 *   GET     /health               健康检查（确认 secret 是否已配置）
 *   GET     /api/oauth/authorize  ?redirect_uri=&state=&scope= → 302 到 GitHub
 *   GET     /api/oauth/authorized GitHub 回调：code+state → 302 回站点，带上 session
 *   POST    /api/oauth/session    { session } → { access_token, scope, token_type }
 *
 * 环境变量：
 *   GITHUB_CLIENT_ID      OAuth App 的 Client ID
 *   GITHUB_CLIENT_SECRET  OAuth App 的 Client Secret（**机密**，只能放这里）
 *   ALLOWED_ORIGINS       允许发起登录、接收令牌的站点来源，逗号分隔。
 *                         **不要填 `*`**：那等于让任何网站都能换走用户令牌。
 *   STATE_SECRET          （可选）信封密钥的附加随机串。轮换它可让所有未完成
 *                         的登录流程立即失效，用于应急处置。
 */

type Bindings = Record<string, string | undefined>

interface RelayConfig {
  clientId: string
  clientSecret: string
  stateSecret: string
  allowedOrigins: string[]
}

/** 加密 state 里携带的内容：登录完成后该把用户送回哪儿。 */
interface AuthorizeState {
  redirectUri: string
  nonce: string
  scope: string
}

/** 加密 session 里携带的内容：站点用它换取明文令牌。 */
interface TokenSession {
  token: string
  scope: string
  tokenType: string
  /** 发起登录的站点来源，用于确认来换令牌的确实是同一个站点。 */
  origin: string
}

const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize'
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token'
/** 请求体只有几个短字符串，超过这个长度一律拒绝。 */
const MAX_BODY_BYTES = 4096
/** 信封格式版本，将来改字段时用它做兼容判断。 */
const ENVELOPE_VERSION = 1
/** state（登录往返）10 分钟足够完成 GitHub 授权，含两步验证。 */
const STATE_TTL_MS = 10 * 60 * 1000
/** session（回跳 → 换令牌）只隔一次页面跳转，给 5 分钟很宽裕。 */
const SESSION_TTL_MS = 5 * 60 * 1000
/** nonce 只是回执标记，长度上限防止有人塞垃圾进加密串。 */
const MAX_NONCE_LENGTH = 128

function readEnv(bindings: Bindings | undefined, name: string): string | undefined {
  // Deno Deploy 把环境变量放在 Deno.env；Cloudflare Workers 通过 fetch 的第二个参数传入。
  const runtime = globalThis as unknown as {
    Deno?: { env?: { get?: (key: string) => string | undefined } }
  }
  const fromDeno = runtime.Deno?.env?.get?.(name)
  if (fromDeno && fromDeno.trim()) return fromDeno.trim()

  const fromBindings = bindings?.[name]
  return fromBindings && fromBindings.trim() ? fromBindings.trim() : undefined
}

function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, '')
}

function resolveConfig(bindings: Bindings | undefined): RelayConfig {
  const allowedOrigins = (readEnv(bindings, 'ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map(normalizeOrigin)
    .filter(Boolean)

  return {
    clientId: readEnv(bindings, 'GITHUB_CLIENT_ID') ?? '',
    clientSecret: readEnv(bindings, 'GITHUB_CLIENT_SECRET') ?? '',
    stateSecret: readEnv(bindings, 'STATE_SECRET') ?? '',
    allowedOrigins,
  }
}

/**
 * 只回显白名单内的 Origin。未命中时响应不带 CORS 头，
 * 浏览器会自行拒绝读取正文——这正是我们要的效果。
 */
function resolveOrigin(request: Request, config: RelayConfig): string | null {
  const origin = request.headers.get('Origin')
  if (!origin) return null
  if (config.allowedOrigins.includes('*')) return origin
  return config.allowedOrigins.includes(normalizeOrigin(origin)) ? origin : null
}

function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = { Vary: 'Origin' }
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin
    headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
    headers['Access-Control-Allow-Headers'] = 'Content-Type'
    headers['Access-Control-Max-Age'] = '86400'
  }
  return headers
}

function json(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // 令牌交换的响应绝不能被任何中间层缓存
      'Cache-Control': 'no-store',
      ...corsHeaders(origin),
    },
  })
}

/**
 * 302 跳到别处。这条响应里带着 state / session，所以既不能缓存，
 * 也不能把地址通过 Referer 泄漏给下一跳。
 */
function redirect(location: string, status = 302): Response {
  return new Response(null, {
    status,
    headers: {
      Location: location,
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    },
  })
}

/**
 * 往 URL 上追加查询参数（不会动已有的片段标识）。
 * 手工拼接是为了让空格稳定编码成 `%20` 而不是 `+`。
 */
function appendQuery(url: string, params: Record<string, string>): string {
  const query = Object.entries(params)
    .filter(([, value]) => value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&')
  if (!query) return url
  return `${url}${url.includes('?') ? '&' : '?'}${query}`
}

function isAllowedOrigin(config: RelayConfig, origin: string): boolean {
  if (config.allowedOrigins.includes('*')) return true
  return config.allowedOrigins.includes(normalizeOrigin(origin))
}

async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  const declared = Number(request.headers.get('Content-Length') ?? '0')
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null
  try {
    const parsed = (await request.json()) as unknown
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function pickString(body: Record<string, unknown>, key: string): string {
  const value = body[key]
  return typeof value === 'string' ? value.trim() : ''
}

/* ------------------------------------------------------------------ *
 * 加密信封
 *
 * giscus 用 AES-GCM 把「回跳地址」和「令牌」分别封成 state / session。
 * 这里照搬同样的思路，密钥由 GITHUB_CLIENT_SECRET（+ 可选 STATE_SECRET）
 * 经 HKDF 派生，因此中转层不需要额外的持久化存储，也不引入任何依赖。
 * ------------------------------------------------------------------ */

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlDecode(value: string): Uint8Array | null {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  try {
    const binary = atob(padded)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
    return bytes
  } catch {
    return null
  }
}

async function deriveEnvelopeKey(config: RelayConfig): Promise<CryptoKey | null> {
  if (!config.clientSecret) return null
  const encoder = new TextEncoder()
  const material = `${config.stateSecret}\n${config.clientSecret}`
  const baseKey = await crypto.subtle.importKey('raw', encoder.encode(material), 'HKDF', false, [
    'deriveKey',
  ])
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: encoder.encode('hdssibal-relay'),
      info: encoder.encode('oauth-envelope-v1'),
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

async function sealEnvelope(key: CryptoKey, value: unknown, ttlMs: number): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const payload = JSON.stringify({ v: ENVELOPE_VERSION, exp: Date.now() + ttlMs, value })
  const sealed = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(payload),
  )
  return `${base64UrlEncode(iv)}.${base64UrlEncode(new Uint8Array(sealed))}`
}

/**
 * 解不开、格式不对、版本不符、已过期，一律返回 null。
 * 不区分失败原因，避免给攻击者任何反馈信号。
 */
async function openEnvelope<T>(
  key: CryptoKey,
  token: string,
): Promise<{ value: T; expired: boolean } | null> {
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const iv = base64UrlDecode(parts[0])
  const ciphertext = base64UrlDecode(parts[1])
  if (!iv || !ciphertext || iv.length !== 12 || ciphertext.length === 0) return null

  let plaintext: string
  try {
    const opened = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext)
    plaintext = new TextDecoder().decode(opened)
  } catch {
    return null
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(plaintext)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null

  const record = parsed as Record<string, unknown>
  if (record.v !== ENVELOPE_VERSION) return null
  const expiresAt = record.exp
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) return null
  // 过期单独标出来：给用户的提示「登录超时」比「凭据无效」有用得多。
  if (Date.now() > expiresAt) return { value: record.value as T, expired: true }
  return { value: record.value as T, expired: false }
}

/* ------------------------------------------------------------------ *
 * 路由辅助
 * ------------------------------------------------------------------ */

const OAUTH_PATHS = ['/api/oauth/authorize', '/api/oauth/authorized', '/api/oauth/session']

/** 推导基地址时需要剥掉的路径后缀。漏掉任何一个，那个端点上报的 callbackUrl 都会多出一截。 */
const BASE_SUFFIXES = [...OAUTH_PATHS, '/health']

/**
 * 中转层自己的公开基地址。从请求 URL 推导，这样换域名、挂子路径都不用作废配置。
 * （站点跳转时用的就是它自己填的那个地址，所以推导出来的必然一致。）
 */
function relayBaseUrl(request: Request): string {
  const url = new URL(request.url)
  let pathname = url.pathname.replace(/\/+$/, '')
  for (const path of BASE_SUFFIXES) {
    if (pathname.endsWith(path)) {
      pathname = pathname.slice(0, pathname.length - path.length)
      break
    }
  }
  return `${url.origin}${pathname}`
}

/** 注册到 GitHub OAuth App 里的那一个固定回调地址。 */
function relayCallbackUrl(request: Request): string {
  return `${relayBaseUrl(request)}/api/oauth/authorized`
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

/**
 * 校验站点给的返回地址。这是整个中转层的安全闸门，所以逐条检查：
 * 来源必须在白名单里、必须是 https（本地开发放行 http 回环）、不能带凭据或片段。
 */
function validateReturnUrl(
  config: RelayConfig,
  value: string,
): { url: URL; error?: undefined; message?: undefined } | { url?: undefined; error: string; message: string } {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return { error: 'invalid_redirect_uri', message: 'redirect_uri 不是合法 URL。' }
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopbackHost(url.hostname))) {
    return {
      error: 'insecure_redirect_uri',
      message: 'redirect_uri 必须是 https 地址（本地开发可用 http://localhost）。',
    }
  }
  if (url.username || url.password) {
    return { error: 'invalid_redirect_uri', message: 'redirect_uri 不能包含用户名或密码。' }
  }
  if (url.hash) {
    return { error: 'invalid_redirect_uri', message: 'redirect_uri 不能包含片段（#）。' }
  }
  if (!isAllowedOrigin(config, url.origin)) {
    return {
      error: 'redirect_uri_not_allowed',
      message: 'redirect_uri 的来源不在 ALLOWED_ORIGINS 中。',
    }
  }
  return { url }
}

/* ------------------------------------------------------------------ *
 * 处理器
 * ------------------------------------------------------------------ */

/** 第一跳：把站点的返回地址封进 state，跳去 GitHub 授权页。 */
async function handleAuthorize(request: Request, config: RelayConfig): Promise<Response> {
  if (request.method !== 'GET') {
    return json({ error: 'method_not_allowed', error_description: '只接受 GET。' }, 405, null)
  }

  const search = new URL(request.url).searchParams
  const redirectUri = (search.get('redirect_uri') ?? '').trim()
  if (!redirectUri) {
    return json(
      { error: 'redirect_uri_required', error_description: '缺少 redirect_uri 查询参数。' },
      400,
      null,
    )
  }

  const target = validateReturnUrl(config, redirectUri)
  if (target.error) {
    return json({ error: target.error, error_description: target.message }, 400, null)
  }

  if (!config.clientId || !config.clientSecret) {
    return json(
      {
        error: 'server_not_configured',
        error_description: '中转服务尚未配置 GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET。',
      },
      500,
      null,
    )
  }

  if (config.allowedOrigins.includes('*')) {
    console.warn(
      '[relay] ALLOWED_ORIGINS=* 意味着任意网站都能用本站的 OAuth App 换走用户令牌，仅限本地调试使用。',
    )
  }

  const key = await deriveEnvelopeKey(config)
  if (!key) {
    return json(
      { error: 'server_not_configured', error_description: '中转服务无法派生加密密钥。' },
      500,
      null,
    )
  }

  const requestedScope = (search.get('scope') ?? '').trim()
  const state = await sealEnvelope(
    key,
    {
      redirectUri,
      nonce: (search.get('state') ?? '').trim().slice(0, MAX_NONCE_LENGTH),
      scope: requestedScope.slice(0, 256),
    },
    STATE_TTL_MS,
  )

  const authorizeUrl = new URL(GITHUB_AUTHORIZE_URL)
  authorizeUrl.searchParams.set('client_id', config.clientId)
  authorizeUrl.searchParams.set('redirect_uri', relayCallbackUrl(request))
  authorizeUrl.searchParams.set('state', state)
  // scope 交给用户自己决定（GitHub 授权页会逐项列出来），中转层不塞默认值。
  if (requestedScope) authorizeUrl.searchParams.set('scope', requestedScope.slice(0, 256))

  return redirect(authorizeUrl.toString())
}

/** 第二跳：GitHub 回调。换令牌，然后把令牌封成 session 送回站点。 */
async function handleAuthorized(request: Request, config: RelayConfig): Promise<Response> {
  if (request.method !== 'GET') {
    return json({ error: 'method_not_allowed', error_description: '只接受 GET。' }, 405, null)
  }

  const search = new URL(request.url).searchParams
  const state = (search.get('state') ?? '').trim()
  const code = (search.get('code') ?? '').trim()
  const githubError = (search.get('error') ?? '').trim()
  const githubErrorDescription = search.get('error_description') ?? ''

  const key = await deriveEnvelopeKey(config)
  const opened = key && state ? await openEnvelope<AuthorizeState>(key, state) : null

  // 解不开 state 就没有可信的回跳目标，只能就地报错。
  if (!opened) {
    return json(
      {
        error: 'invalid_state',
        error_description: '登录状态校验失败（可能已被篡改），请回到站点重新登录。',
      },
      400,
      null,
    )
  }
  if (opened.expired) {
    return json(
      { error: 'state_expired', error_description: '登录已超时，请回到站点重新登录。' },
      400,
      null,
    )
  }

  const payload = opened.value
  if (typeof payload !== 'object' || payload === null) {
    return json({ error: 'invalid_state', error_description: '登录状态内容无效。' }, 400, null)
  }

  const nonce = typeof payload.nonce === 'string' ? payload.nonce : ''

  // 回跳地址在加密信封里，正常无法被改；这里再校验一次是纵深防御，
  // 顺带兜住「中转层换了 ALLOWED_ORIGINS」的情况。
  const target = validateReturnUrl(config, typeof payload.redirectUri === 'string' ? payload.redirectUri : '')
  if (target.error) {
    return json({ error: target.error, error_description: target.message }, 400, null)
  }
  const returnUrl = target.url.toString()

  if (githubError) {
    return redirect(
      appendQuery(returnUrl, {
        error: githubError,
        error_description: githubErrorDescription,
        state: nonce,
      }),
    )
  }
  if (!code) {
    return redirect(
      appendQuery(returnUrl, {
        error: 'missing_code',
        error_description: 'GitHub 未返回授权码。',
        state: nonce,
      }),
    )
  }
  if (!config.clientId || !config.clientSecret || !key) {
    return redirect(
      appendQuery(returnUrl, {
        error: 'server_not_configured',
        error_description: '中转服务尚未配置 GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET。',
        state: nonce,
      }),
    )
  }

  const params = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    // 必须与授权请求里带的 redirect_uri 完全一致，GitHub 会比对。
    redirect_uri: relayCallbackUrl(request),
  })

  let githubResponse: Response
  try {
    githubResponse = await fetch(GITHUB_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: params.toString(),
    })
  } catch (caught) {
    // 记到部署平台的日志里（Deno Deploy / Workers 都能在控制台看到），否则线上出网络问题只能看到一句 502
    console.error('[relay] 访问 GitHub 换取令牌失败：', caught)
    return redirect(
      appendQuery(returnUrl, {
        error: 'upstream_unreachable',
        error_description: '无法访问 GitHub，请稍后重试。',
        state: nonce,
      }),
    )
  }

  const text = await githubResponse.text()
  let payloadFromGitHub: Record<string, unknown>
  try {
    payloadFromGitHub = JSON.parse(text) as Record<string, unknown>
  } catch {
    // GitHub 默认返回 form-urlencoded，只有带了 Accept: application/json 才是 JSON。兼容一下。
    payloadFromGitHub = Object.fromEntries(new URLSearchParams(text))
  }

  const accessToken =
    typeof payloadFromGitHub.access_token === 'string' ? payloadFromGitHub.access_token : ''
  if (!accessToken) {
    // 只透传 GitHub 的错误码与描述，绝不把请求参数或 secret 泄漏回去。
    return redirect(
      appendQuery(returnUrl, {
        error:
          typeof payloadFromGitHub.error === 'string'
            ? payloadFromGitHub.error
            : 'token_exchange_failed',
        error_description:
          typeof payloadFromGitHub.error_description === 'string'
            ? payloadFromGitHub.error_description
            : '',
        state: nonce,
      }),
    )
  }

  const session = await sealEnvelope(
    key,
    {
      token: accessToken,
      scope: typeof payloadFromGitHub.scope === 'string' ? payloadFromGitHub.scope : '',
      tokenType: typeof payloadFromGitHub.token_type === 'string' ? payloadFromGitHub.token_type : 'bearer',
      origin: target.url.origin,
    },
    SESSION_TTL_MS,
  )

  return redirect(appendQuery(returnUrl, { session, state: nonce }))
}

/** 第三跳：站点拿 session 换明文令牌。跨域 POST，需要 CORS。 */
async function handleSession(
  request: Request,
  config: RelayConfig,
  origin: string | null,
): Promise<Response> {
  if (request.method !== 'POST') {
    return json({ error: 'method_not_allowed', error_description: '只接受 POST。' }, 405, origin)
  }

  // 浏览器发起的跨域请求一定带 Origin。缺了就说明不是正常来源，直接拒绝。
  if (!origin) {
    return json(
      { error: 'forbidden_origin', error_description: '请求来源不在允许列表中。' },
      403,
      null,
    )
  }

  const body = await readJsonBody(request)
  if (!body) {
    return json(
      { error: 'invalid_request_body', error_description: '请求体必须是小于 4 KB 的 JSON 对象。' },
      400,
      origin,
    )
  }

  const session = pickString(body, 'session')
  if (!session) {
    return json({ error: 'missing_session', error_description: '缺少 session。' }, 400, origin)
  }

  const key = await deriveEnvelopeKey(config)
  const opened = key ? await openEnvelope<TokenSession>(key, session) : null
  if (!opened) {
    return json(
      { error: 'invalid_session', error_description: '登录凭据无效，请重新登录。' },
      400,
      origin,
    )
  }
  if (opened.expired) {
    return json(
      { error: 'session_expired', error_description: '登录凭据已过期，请重新登录。' },
      400,
      origin,
    )
  }

  const payload = opened.value
  if (typeof payload !== 'object' || payload === null || typeof payload.token !== 'string') {
    return json({ error: 'invalid_session', error_description: '登录凭据内容无效。' }, 400, origin)
  }
  // 纵深防御：session 只对当初发起登录的那个站点有效。
  if (payload.origin !== origin) {
    return json(
      { error: 'session_origin_mismatch', error_description: '登录凭据与当前站点不匹配。' },
      403,
      origin,
    )
  }

  return json(
    {
      access_token: payload.token,
      scope: typeof payload.scope === 'string' ? payload.scope : '',
      token_type: typeof payload.tokenType === 'string' ? payload.tokenType : 'bearer',
    },
    200,
    origin,
  )
}

function handleHealth(request: Request, config: RelayConfig, origin: string | null): Response {
  return json(
    {
      ok: true,
      service: 'hdssibal-arena-oauth-relay',
      configured: Boolean(config.clientId && config.clientSecret),
      allowedOriginCount: config.allowedOrigins.length,
      allowsAnyOrigin: config.allowedOrigins.includes('*'),
      envelopeKeyFrom: config.stateSecret
        ? 'STATE_SECRET + GITHUB_CLIENT_SECRET'
        : 'GITHUB_CLIENT_SECRET',
      // 这个地址要填进 GitHub OAuth App 的 Authorization callback URL
      callbackUrl: relayCallbackUrl(request),
    },
    200,
    origin,
  )
}

export default {
  async fetch(request: Request, bindings?: Bindings): Promise<Response> {
    const config = resolveConfig(bindings)
    const origin = resolveOrigin(request, config)
    const route = new URL(request.url).pathname.replace(/\/+$/, '') || '/'

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) })
    }

    if (route === '/' || route === '/health') return handleHealth(request, config, origin)
    if (route === '/api/oauth/authorize') return handleAuthorize(request, config)
    if (route === '/api/oauth/authorized') return handleAuthorized(request, config)
    if (route === '/api/oauth/session') return handleSession(request, config, origin)

    return json({ error: 'not_found', error_description: `未知路径 ${route}` }, 404, origin)
  },
}
