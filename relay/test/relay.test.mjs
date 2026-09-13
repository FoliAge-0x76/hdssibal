import assert from 'node:assert/strict'
import test from 'node:test'
import relay from '../src/relay.ts'

/**
 * 中转层的逻辑测试。不需要部署、不需要网络：把 globalThis.fetch 换成桩，
 * 直接调用 relay 的 fetch 处理器，断言它跳给 GitHub 的参数、跳回站点的参数
 * 以及响应头里的安全设置。
 *
 *   cd relay && npm test
 */

const SITE_ORIGIN = 'https://arena.example.com'
const LOCAL_ORIGIN = 'http://localhost:5173'
const RELAY_BASE = 'https://relay.example.deno.dev'
const CALLBACK_URL = `${RELAY_BASE}/api/oauth/authorized`
const RETURN_URL = `${SITE_ORIGIN}/oauth/callback.html`

const ENV = {
  GITHUB_CLIENT_ID: 'cid_test_123',
  GITHUB_CLIENT_SECRET: 'super-secret-value',
  ALLOWED_ORIGINS: `${SITE_ORIGIN}, ${LOCAL_ORIGIN}`,
}

const CLIENT_SECRET = 'super-secret-value'
const ACCESS_TOKEN = 'gho_test_token_abcdef'

const realFetch = globalThis.fetch
test.afterEach(() => {
  globalThis.fetch = realFetch
})

function call(path, { method = 'GET', origin = SITE_ORIGIN, body, env = ENV } = {}) {
  const headers = {}
  if (origin) headers.Origin = origin
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  return relay.fetch(
    new Request(`${RELAY_BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    }),
    env,
  )
}

/** 把发往 GitHub 的请求截下来，返回一个可断言的记录。 */
function stubGitHub(payload, { status = 200, raw, throws } = {}) {
  const captured = { calls: 0 }
  globalThis.fetch = async (url, init) => {
    captured.calls += 1
    captured.url = String(url)
    captured.method = init?.method
    captured.params = new URLSearchParams(String(init?.body ?? ''))
    if (throws) throw throws
    return new Response(raw ?? JSON.stringify(payload), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  return captured
}

/** 第一跳：请求 /api/oauth/authorize，返回跳给 GitHub 的地址。 */
async function startAuthorize({ redirectUri = RETURN_URL, nonce = '', scope = '', ...rest } = {}) {
  const query = new URLSearchParams({ redirect_uri: redirectUri })
  if (nonce) query.set('state', nonce)
  if (scope) query.set('scope', scope)
  const response = await call(`/api/oauth/authorize?${query}`, { origin: null, ...rest })
  const location = response.headers.get('Location')
  const authorizeUrl = location ? new URL(location) : null
  // GitHub 会把 state 原样回传，所以后续几跳要用的「state」是中转层加密后的信封。
  return { response, location, authorizeUrl, state: authorizeUrl?.searchParams.get('state') ?? '' }
}

/**
 * 用与中转层相同的密钥派生方式手工封一个信封，用来造「过期 / 换密钥」的用例。
 * 这里刻意重写一遍算法：如果哪天实现的密钥派生改了，这些测试会失败，
 * 而不是跟着实现一起错。
 */
async function sealEnvelope(
  value,
  { exp = Date.now() + 60_000, secret = CLIENT_SECRET, stateSecret = '' } = {},
) {
  const encoder = new TextEncoder()
  const baseKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(`${stateSecret}\n${secret}`),
    'HKDF',
    false,
    ['deriveKey'],
  )
  const key = await crypto.subtle.deriveKey(
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
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const sealed = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(JSON.stringify({ v: 1, exp, value })),
  )
  const encode = (bytes) => Buffer.from(bytes).toString('base64url')
  return `${encode(iv)}.${encode(new Uint8Array(sealed))}`
}

async function jsonBody(response) {
  return JSON.parse(await response.text())
}

/* ------------------------------------------------------------------ *
 * 基础路由与预检
 * ------------------------------------------------------------------ */

test('OPTIONS 预检返回 204 且回显白名单内的 Origin', async () => {
  const response = await call('/api/oauth/session', { method: 'OPTIONS' })
  assert.equal(response.status, 204)
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), SITE_ORIGIN)
  assert.equal(response.headers.get('Vary'), 'Origin')
  assert.equal(await response.text(), '')
})

test('OPTIONS 预检不回显白名单外的 Origin', async () => {
  const response = await call('/api/oauth/session', {
    method: 'OPTIONS',
    origin: 'https://evil.example',
  })
  assert.equal(response.status, 204)
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), null)
})

test('/health 报告配置状态与需要填进 GitHub 的回调地址', async () => {
  const response = await call('/health', { origin: null })
  const body = await jsonBody(response)
  assert.equal(response.status, 200)
  assert.equal(body.ok, true)
  assert.equal(body.configured, true)
  assert.equal(body.allowedOriginCount, 2)
  assert.equal(body.allowsAnyOrigin, false)
  assert.equal(body.envelopeKeyFrom, 'GITHUB_CLIENT_SECRET')
  assert.equal(body.callbackUrl, CALLBACK_URL)
})

test('/health 会如实报告 STATE_SECRET 与通配来源', async () => {
  const response = await call('/health', {
    origin: null,
    env: { ...ENV, STATE_SECRET: 'pepper', ALLOWED_ORIGINS: '*' },
  })
  const body = await jsonBody(response)
  assert.equal(body.allowsAnyOrigin, true)
  assert.equal(body.envelopeKeyFrom, 'STATE_SECRET + GITHUB_CLIENT_SECRET')
})

test('未知路径返回 404，旧的 /api/token 已经下线', async () => {
  for (const path of ['/api/token', '/api/nope']) {
    const response = await call(path, { method: 'POST', body: { code: 'x' } })
    assert.equal(response.status, 404)
    assert.equal((await jsonBody(response)).error, 'not_found')
  }
})

/* ------------------------------------------------------------------ *
 * 第一跳：/api/oauth/authorize
 * ------------------------------------------------------------------ */

test('authorize 缺少 redirect_uri 时返回 400', async () => {
  const response = await call('/api/oauth/authorize', { origin: null })
  assert.equal(response.status, 400)
  assert.equal((await jsonBody(response)).error, 'redirect_uri_required')
})

test('authorize 拒绝非法、非白名单、带片段或带凭据的 redirect_uri', async () => {
  const cases = [
    ['not-a-url', 'invalid_redirect_uri'],
    ['https://evil.example/oauth/callback.html', 'redirect_uri_not_allowed'],
    ['http://arena.example.com/oauth/callback.html', 'insecure_redirect_uri'],
    [`${SITE_ORIGIN}/oauth/callback.html#/submit`, 'invalid_redirect_uri'],
    ['https://user:pass@arena.example.com/oauth/callback.html', 'invalid_redirect_uri'],
  ]
  for (const [redirectUri, expected] of cases) {
    const response = await call(
      `/api/oauth/authorize?redirect_uri=${encodeURIComponent(redirectUri)}`,
      { origin: null },
    )
    assert.equal(response.status, 400, redirectUri)
    assert.equal((await jsonBody(response)).error, expected, redirectUri)
  }
})

test('authorize 放行本地开发的 http://localhost', async () => {
  globalThis.fetch = realFetch
  const { response, authorizeUrl } = await startAuthorize({
    redirectUri: `${LOCAL_ORIGIN}/oauth/callback.html`,
  })
  assert.equal(response.status, 302)
  assert.equal(authorizeUrl.origin, 'https://github.com')
})

test('authorize 未配置 secret 时返回 500', async () => {
  const response = await call(`/api/oauth/authorize?redirect_uri=${encodeURIComponent(RETURN_URL)}`, {
    origin: null,
    env: { GITHUB_CLIENT_ID: 'cid', ALLOWED_ORIGINS: SITE_ORIGIN },
  })
  assert.equal(response.status, 500)
  assert.equal((await jsonBody(response)).error, 'server_not_configured')
})

test('authorize 只接受 GET', async () => {
  const response = await call('/api/oauth/authorize?redirect_uri=x', {
    method: 'POST',
    origin: null,
    body: {},
  })
  assert.equal(response.status, 405)
})

test('authorize 跳到 GitHub 授权页，且 redirect_uri 固定为 relay 自己的回调地址', async () => {
  const { response, authorizeUrl } = await startAuthorize({ nonce: 'nonce-abc' })

  assert.equal(response.status, 302)
  assert.equal(response.headers.get('Cache-Control'), 'no-store')
  assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer')

  assert.equal(authorizeUrl.origin, 'https://github.com')
  assert.equal(authorizeUrl.pathname, '/login/oauth/authorize')
  assert.equal(authorizeUrl.searchParams.get('client_id'), ENV.GITHUB_CLIENT_ID)
  assert.equal(authorizeUrl.searchParams.get('redirect_uri'), CALLBACK_URL)
  // 没有 scope 就不要带 scope 参数
  assert.equal(authorizeUrl.searchParams.has('scope'), false)
  // state 是加密信封，站点地址不该出现在里面
  const state = authorizeUrl.searchParams.get('state')
  assert.ok(state && state.includes('.'))
  assert.ok(!state.includes('arena.example.com'))
})

test('authorize 无论站点来源是哪一个，跳给 GitHub 的回调都是同一个地址', async () => {
  const fromSite = await startAuthorize()
  const fromLocal = await startAuthorize({ redirectUri: `${LOCAL_ORIGIN}/oauth/callback.html` })
  assert.equal(fromSite.authorizeUrl.searchParams.get('redirect_uri'), CALLBACK_URL)
  assert.equal(fromLocal.authorizeUrl.searchParams.get('redirect_uri'), CALLBACK_URL)
  // 但两个 state 不同（各自封了自己的返回地址）
  assert.notEqual(fromSite.authorizeUrl.searchParams.get('state'), fromLocal.authorizeUrl.searchParams.get('state'))
})

test('authorize 把 scope 原样交给 GitHub 让用户确认', async () => {
  const { authorizeUrl } = await startAuthorize({ scope: 'read:user public_repo' })
  assert.equal(authorizeUrl.searchParams.get('scope'), 'read:user public_repo')
})

/* ------------------------------------------------------------------ *
 * 第二跳：/api/oauth/authorized
 * ------------------------------------------------------------------ */

test('authorized 在 state 缺失 / 被篡改 / 换密钥时一律返回 invalid_state', async () => {
  const { state } = await startAuthorize()
  const forged = await sealEnvelope(
    { redirectUri: RETURN_URL, nonce: '', scope: '' },
    { secret: 'other-secret' },
  )

  const cases = [
    ['', 'invalid_state'],
    ['garbage', 'invalid_state'],
    [`${state}x`, 'invalid_state'],
    [forged, 'invalid_state'],
  ]
  for (const [value, expected] of cases) {
    const response = await call(
      `/api/oauth/authorized?code=abc&state=${encodeURIComponent(value)}`,
      { origin: null },
    )
    assert.equal(response.status, 400, value.slice(0, 12))
    assert.equal((await jsonBody(response)).error, expected)
  }
})

test('authorized 对过期的 state 单独回报 state_expired', async () => {
  const expired = await sealEnvelope(
    { redirectUri: RETURN_URL, nonce: 'n1', scope: '' },
    { exp: Date.now() - 1000 },
  )
  const response = await call(`/api/oauth/authorized?code=abc&state=${encodeURIComponent(expired)}`, {
    origin: null,
  })
  assert.equal(response.status, 400)
  assert.equal((await jsonBody(response)).error, 'state_expired')
})

test('authorized 把用户拒绝授权的错误原样送回站点', async () => {
  const { state } = await startAuthorize({ nonce: 'nonce-abc' })
  const response = await call(
    `/api/oauth/authorized?error=access_denied&error_description=The+user+denied&state=${encodeURIComponent(state)}`,
    { origin: null },
  )

  assert.equal(response.status, 302)
  const back = new URL(response.headers.get('Location'))
  assert.equal(back.origin + back.pathname, RETURN_URL)
  assert.equal(back.searchParams.get('error'), 'access_denied')
  assert.equal(back.searchParams.get('error_description'), 'The user denied')
  assert.equal(back.searchParams.get('state'), 'nonce-abc')
  assert.equal(back.searchParams.has('session'), false)
})

test('authorized 在 GitHub 没给 code 时报 missing_code', async () => {
  const { state } = await startAuthorize()
  const response = await call(`/api/oauth/authorized?state=${encodeURIComponent(state)}`, {
    origin: null,
  })
  const back = new URL(response.headers.get('Location'))
  assert.equal(back.searchParams.get('error'), 'missing_code')
})

test('authorized 用 client_secret 换令牌，并把 session 送回站点而不是明文令牌', async () => {
  const github = stubGitHub({ access_token: ACCESS_TOKEN, scope: 'read:user', token_type: 'bearer' })
  const { state, authorizeUrl } = await startAuthorize({ nonce: 'nonce-abc', scope: 'read:user' })

  const response = await call(`/api/oauth/authorized?code=the-code&state=${encodeURIComponent(state)}`, {
    origin: null,
  })

  assert.equal(response.status, 302)
  assert.equal(response.headers.get('Cache-Control'), 'no-store')
  assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer')

  // 换令牌时用的 redirect_uri 必须与授权请求里的一致，否则 GitHub 会拒绝
  assert.equal(github.calls, 1)
  assert.equal(github.url, 'https://github.com/login/oauth/access_token')
  assert.equal(github.method, 'POST')
  assert.equal(github.params.get('client_id'), ENV.GITHUB_CLIENT_ID)
  assert.equal(github.params.get('client_secret'), CLIENT_SECRET)
  assert.equal(github.params.get('code'), 'the-code')
  assert.equal(
    github.params.get('redirect_uri'),
    authorizeUrl.searchParams.get('redirect_uri'),
  )

  const back = new URL(response.headers.get('Location'))
  assert.equal(back.origin + back.pathname, RETURN_URL)
  assert.equal(back.searchParams.get('state'), 'nonce-abc')
  const session = back.searchParams.get('session')
  assert.ok(session && session.includes('.'))
  // 令牌绝不能出现在跳转地址里
  assert.ok(!response.headers.get('Location').includes(ACCESS_TOKEN))
})

test('authorized 兼容 GitHub 返回的 form-urlencoded', async () => {
  stubGitHub(null, { raw: `access_token=${ACCESS_TOKEN}&scope=read%3Auser&token_type=bearer` })
  const { state } = await startAuthorize()
  const response = await call(`/api/oauth/authorized?code=c&state=${encodeURIComponent(state)}`, {
    origin: null,
  })
  assert.equal(response.status, 302)
  assert.ok(new URL(response.headers.get('Location')).searchParams.get('session'))
})

test('authorized 在 GitHub 报错时不泄漏 secret 并原样回传错误码', async () => {
  stubGitHub({ error: 'bad_verification_code', error_description: 'The code passed is incorrect' })
  const { state } = await startAuthorize({ nonce: 'nonce-abc' })
  const response = await call(`/api/oauth/authorized?code=c&state=${encodeURIComponent(state)}`, {
    origin: null,
  })

  const raw = response.headers.get('Location')
  const back = new URL(raw)
  assert.equal(back.searchParams.get('error'), 'bad_verification_code')
  assert.equal(back.searchParams.get('state'), 'nonce-abc')
  assert.ok(!raw.includes(CLIENT_SECRET))
})

test('authorized 在 GitHub 不可达时回传 upstream_unreachable', async () => {
  stubGitHub(null, { throws: new Error('network down') })
  const { state } = await startAuthorize()
  const response = await call(`/api/oauth/authorized?code=c&state=${encodeURIComponent(state)}`, {
    origin: null,
  })
  const back = new URL(response.headers.get('Location'))
  assert.equal(back.searchParams.get('error'), 'upstream_unreachable')
})

/* ------------------------------------------------------------------ *
 * 第三跳：/api/oauth/session
 * ------------------------------------------------------------------ */

/** 走完整的 authorize → authorized 两跳，拿到回跳地址里的 session。 */
async function obtainSession({ redirectUri = RETURN_URL, nonce = '' } = {}) {
  const { state } = await startAuthorize({ redirectUri, nonce })
  const response = await call(`/api/oauth/authorized?code=the-code&state=${encodeURIComponent(state)}`, {
    origin: null,
  })
  return new URL(response.headers.get('Location')).searchParams.get('session')
}

test('session 用加密会话信封换出明文令牌', async () => {
  stubGitHub({ access_token: ACCESS_TOKEN, scope: 'read:user', token_type: 'bearer' })
  const session = await obtainSession()

  const response = await call('/api/oauth/session', { method: 'POST', body: { session } })
  const body = await jsonBody(response)

  assert.equal(response.status, 200)
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), SITE_ORIGIN)
  assert.equal(response.headers.get('Cache-Control'), 'no-store')
  assert.equal(body.access_token, ACCESS_TOKEN)
  assert.equal(body.scope, 'read:user')
  assert.equal(body.token_type, 'bearer')
})

test('session 要求带 Origin，且来源必须在白名单内', async () => {
  const noOrigin = await call('/api/oauth/session', {
    method: 'POST',
    origin: null,
    body: { session: 'x' },
  })
  assert.equal(noOrigin.status, 403)
  assert.equal((await jsonBody(noOrigin)).error, 'forbidden_origin')

  const foreign = await call('/api/oauth/session', {
    method: 'POST',
    origin: 'https://evil.example',
    body: { session: 'x' },
  })
  assert.equal(foreign.status, 403)
  assert.equal(foreign.headers.get('Access-Control-Allow-Origin'), null)
})

test('session 不能拿 A 站点签发的凭据到 B 站点来换', async () => {
  stubGitHub({ access_token: ACCESS_TOKEN })
  const session = await obtainSession()

  const response = await call('/api/oauth/session', {
    method: 'POST',
    origin: LOCAL_ORIGIN,
    body: { session },
  })
  assert.equal(response.status, 403)
  assert.equal((await jsonBody(response)).error, 'session_origin_mismatch')
})

test('session 对伪造 / 过期 / 换密钥的凭据分别报错', async () => {
  const forged = await sealEnvelope(
    { token: ACCESS_TOKEN, origin: SITE_ORIGIN },
    { secret: 'other-secret' },
  )
  const expired = await sealEnvelope(
    { token: ACCESS_TOKEN, origin: SITE_ORIGIN },
    { exp: Date.now() - 1000 },
  )

  const cases = [
    ['not-a-envelope', 'invalid_session'],
    [forged, 'invalid_session'],
    [expired, 'session_expired'],
  ]
  for (const [session, expected] of cases) {
    const response = await call('/api/oauth/session', { method: 'POST', body: { session } })
    assert.equal(response.status, 400, expected)
    assert.equal((await jsonBody(response)).error, expected)
  }
})

test('session 拒绝缺失 session 与非 JSON 请求体', async () => {
  const missing = await call('/api/oauth/session', { method: 'POST', body: {} })
  assert.equal(missing.status, 400)
  assert.equal((await jsonBody(missing)).error, 'missing_session')

  const notJson = await call('/api/oauth/session', { method: 'POST', body: '<xml/>' })
  assert.equal(notJson.status, 400)
  assert.equal((await jsonBody(notJson)).error, 'invalid_request_body')
})

test('session 只接受 POST', async () => {
  const response = await call('/api/oauth/session')
  assert.equal(response.status, 405)
  assert.equal((await jsonBody(response)).error, 'method_not_allowed')
})

test('换过 STATE_SECRET 的部署解不开旧部署签发的凭据', async () => {
  const env = { ...ENV, STATE_SECRET: 'pepper' }
  const session = await sealEnvelope(
    { token: ACCESS_TOKEN, origin: SITE_ORIGIN },
    { stateSecret: 'pepper' },
  )
  const ok = await call('/api/oauth/session', { method: 'POST', body: { session }, env })
  assert.equal(ok.status, 200)

  const rotated = await call('/api/oauth/session', {
    method: 'POST',
    body: { session },
    env: { ...env, STATE_SECRET: 'rotated' },
  })
  assert.equal(rotated.status, 400)
  assert.equal((await jsonBody(rotated)).error, 'invalid_session')
})
