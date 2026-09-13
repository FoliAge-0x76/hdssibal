/**
 * GitHub OAuth 中转层。
 *
 * 为什么需要它：GitHub 的 `https://github.com/login/oauth/access_token` 端点
 * 不返回任何 CORS 响应头，且 `client_secret` 是必填参数（PKCE 不能替代）。
 * 纯静态站点既读不到响应，也不能把 secret 放进前端产物，所以必须有一个
 * 自己掌控的中间层来持有 secret 并完成 code → token 的交换。
 *
 * 这一份代码同时适用于 **Deno Deploy** 和 **Cloudflare Workers**：
 * 两者都使用 Web 标准 API，入口都是 `export default { fetch }`。
 * 环境变量的读取做了兼容（Deno 走 Deno.env，Workers 走 fetch 的第二个参数）。
 *
 * 接口：
 *   OPTIONS *            预检，返回 204 + CORS 头
 *   GET     /            服务说明
 *   GET     /health      健康检查（用于确认 secret 是否已配置）
 *   POST    /api/token   { code, code_verifier?, redirect_uri } → { access_token, scope, token_type }
 *
 * 环境变量：
 *   GITHUB_CLIENT_ID      OAuth App 的 Client ID（非敏感，但仍放服务端统一管理）
 *   GITHUB_CLIENT_SECRET  OAuth App 的 Client Secret（**机密**，只能放这里）
 *   ALLOWED_ORIGINS       允许调用本服务的站点来源，逗号分隔；填 * 表示不限制
 */

type Bindings = Record<string, string | undefined>

interface RelayConfig {
  clientId: string
  clientSecret: string
  allowedOrigins: string[]
}

const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token'
/** 请求体只有几个短字符串，超过这个长度一律拒绝。 */
const MAX_BODY_BYTES = 4096

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

async function handleToken(
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

  if (!config.clientId || !config.clientSecret) {
    return json(
      {
        error: 'server_not_configured',
        error_description: '中转服务尚未配置 GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET。',
      },
      500,
      origin,
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

  const code = pickString(body, 'code')
  const codeVerifier = pickString(body, 'code_verifier')
  const redirectUri = pickString(body, 'redirect_uri')

  if (!code) return json({ error: 'missing_code', error_description: '缺少 code。' }, 400, origin)
  if (!redirectUri) {
    return json(
      { error: 'missing_redirect_uri', error_description: '缺少 redirect_uri。' },
      400,
      origin,
    )
  }

  // 纵深防御：即便前端被篡改，也只允许把授权码回送到白名单内的站点。
  // （请求本身的 Origin 已由 resolveOrigin 校验过，这里再校验回跳目标。）
  let redirectOrigin: string
  try {
    redirectOrigin = new URL(redirectUri).origin
  } catch {
    return json(
      { error: 'invalid_redirect_uri', error_description: 'redirect_uri 不是合法 URL。' },
      400,
      origin,
    )
  }
  if (!isAllowedOrigin(config, redirectOrigin)) {
    return json(
      {
        error: 'redirect_uri_not_allowed',
        error_description: 'redirect_uri 的来源不在允许列表中。',
      },
      400,
      origin,
    )
  }

  const params = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    redirect_uri: redirectUri,
  })
  // PKCE 不能替代 client_secret，但两者可以同时使用，多一层保护。
  if (codeVerifier) params.set('code_verifier', codeVerifier)

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
    return json(
      { error: 'upstream_unreachable', error_description: '无法访问 GitHub，请稍后重试。' },
      502,
      origin,
    )
  }

  const text = await githubResponse.text()
  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(text) as Record<string, unknown>
  } catch {
    // GitHub 默认返回 form-urlencoded，只有带了 Accept: application/json 才是 JSON。兼容一下。
    payload = Object.fromEntries(new URLSearchParams(text))
  }

  const accessToken = typeof payload.access_token === 'string' ? payload.access_token : ''
  if (!accessToken) {
    // 只透传 GitHub 的错误码与描述，绝不把请求参数或 secret 泄漏回去。
    return json(
      {
        error: typeof payload.error === 'string' ? payload.error : 'token_exchange_failed',
        error_description:
          typeof payload.error_description === 'string' ? payload.error_description : '',
      },
      400,
      origin,
    )
  }

  return json(
    {
      access_token: accessToken,
      scope: typeof payload.scope === 'string' ? payload.scope : '',
      token_type: typeof payload.token_type === 'string' ? payload.token_type : 'bearer',
    },
    200,
    origin,
  )
}

function handleHealth(config: RelayConfig, origin: string | null): Response {
  return json(
    {
      ok: true,
      service: 'hdssibal-arena-oauth-relay',
      configured: Boolean(config.clientId && config.clientSecret),
      allowedOriginCount: config.allowedOrigins.length,
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

    if (route === '/' || route === '/health') return handleHealth(config, origin)
    if (route === '/api/token') return handleToken(request, config, origin)

    return json({ error: 'not_found', error_description: `未知路径 ${route}` }, 404, origin)
  },
}
