import assert from 'node:assert/strict'
import test from 'node:test'
import relay from '../src/relay.ts'

/**
 * 中转层的逻辑测试。不需要部署、不需要网络：把 globalThis.fetch 换成桩，
 * 直接调用 relay 的 fetch 处理器，断言它转发给 GitHub 的参数和返回给浏览器的头。
 *
 *   node relay/test/relay.test.mjs
 */

const SITE_ORIGIN = 'https://arena.example.com'
const LOCAL_ORIGIN = 'http://localhost:5173'
const REDIRECT_URI = `${SITE_ORIGIN}/`

const ENV = {
  GITHUB_CLIENT_ID: 'cid_test_123',
  GITHUB_CLIENT_SECRET: 'super-secret-value',
  ALLOWED_ORIGINS: `${SITE_ORIGIN}, ${LOCAL_ORIGIN}`,
}

function call(path, { method = 'GET', origin = SITE_ORIGIN, body } = {}) {
  const headers = {}
  if (origin) headers.Origin = origin
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  return relay.fetch(
    new Request(`https://relay.example.deno.dev${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    }),
    ENV,
  )
}

/** 把发往 GitHub 的请求截下来，返回一个可断言的记录。 */
function stubGitHub(payload, status = 200) {
  const captured = { calls: 0 }
  globalThis.fetch = async (url, init) => {
    captured.calls += 1
    captured.url = String(url)
    captured.method = init?.method
    captured.params = new URLSearchParams(String(init?.body ?? ''))
    return new Response(JSON.stringify(payload), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  return captured
}

test('OPTIONS 预检返回 204 且回显白名单内的 Origin', async () => {
  const response = await call('/api/token', { method: 'OPTIONS' })
  assert.equal(response.status, 204)
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), SITE_ORIGIN)
  assert.equal(response.headers.get('Vary'), 'Origin')
  assert.equal(await response.text(), '')
})

test('非白名单 Origin 拿不到 CORS 头', async () => {
  const response = await call('/api/token', {
    method: 'OPTIONS',
    origin: 'https://evil.example.com',
  })
  assert.equal(response.status, 204)
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), null)
})

test('/health 报告 secret 已配置', async () => {
  const response = await call('/health')
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.ok, true)
  assert.equal(body.configured, true)
  assert.equal(body.allowedOriginCount, 2)
})

test('缺少 secret 时拒绝换取令牌', async () => {
  globalThis.fetch = async () => {
    throw new Error('不应该访问 GitHub')
  }
  const response = await relay.fetch(
    new Request('https://relay.example.deno.dev/api/token', {
      method: 'POST',
      headers: { Origin: SITE_ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'c', redirect_uri: REDIRECT_URI }),
    }),
    { ...ENV, GITHUB_CLIENT_SECRET: '' },
  )
  assert.equal(response.status, 500)
  assert.equal((await response.json()).error, 'server_not_configured')
})

test('成功路径：把 code、code_verifier、redirect_uri 和 secret 一起转发给 GitHub', async () => {
  const upstream = stubGitHub({
    access_token: 'gho_token',
    scope: 'public_repo',
    token_type: 'bearer',
  })

  const response = await call('/api/token', {
    method: 'POST',
    body: { code: 'the-code', code_verifier: 'the-verifier', redirect_uri: REDIRECT_URI },
  })

  assert.equal(response.status, 200)
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), SITE_ORIGIN)
  assert.equal(response.headers.get('Cache-Control'), 'no-store')

  const body = await response.json()
  assert.deepEqual(body, { access_token: 'gho_token', scope: 'public_repo', token_type: 'bearer' })

  assert.equal(upstream.url, 'https://github.com/login/oauth/access_token')
  assert.equal(upstream.method, 'POST')
  assert.equal(upstream.params.get('client_id'), 'cid_test_123')
  assert.equal(upstream.params.get('client_secret'), 'super-secret-value')
  assert.equal(upstream.params.get('code'), 'the-code')
  assert.equal(upstream.params.get('code_verifier'), 'the-verifier')
  assert.equal(upstream.params.get('redirect_uri'), REDIRECT_URI)
})

test('secret 不会出现在返回给浏览器的正文里', async () => {
  stubGitHub({
    error: 'bad_verification_code',
    error_description: 'The code passed is incorrect',
  })

  const response = await call('/api/token', {
    method: 'POST',
    body: { code: 'wrong', redirect_uri: REDIRECT_URI },
  })

  assert.equal(response.status, 400)
  const text = await response.text()
  assert.equal(text.includes('super-secret-value'), false)
  const body = JSON.parse(text)
  assert.equal(body.error, 'bad_verification_code')
  assert.equal(body.error_description, 'The code passed is incorrect')
})

test('GitHub 返回 form-urlencoded 时也能解析', async () => {
  globalThis.fetch = async () =>
    new Response('access_token=gho_plain&scope=repo&token_type=bearer', {
      status: 200,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })

  const response = await call('/api/token', {
    method: 'POST',
    body: { code: 'c', redirect_uri: REDIRECT_URI },
  })
  assert.equal(response.status, 200)
  assert.equal((await response.json()).access_token, 'gho_plain')
})

test('无法访问 GitHub 时返回 502 并记录日志', async (t) => {
  t.mock.method(console, 'error', () => {})
  globalThis.fetch = async () => {
    throw new TypeError('fetch failed')
  }

  const response = await call('/api/token', {
    method: 'POST',
    body: { code: 'c', redirect_uri: REDIRECT_URI },
  })

  assert.equal(response.status, 502)
  assert.equal((await response.json()).error, 'upstream_unreachable')
  assert.equal(console.error.mock.callCount(), 1)
})

test('redirect_uri 指向白名单外时拒绝转发', async () => {
  let called = false
  globalThis.fetch = async () => {
    called = true
    return new Response('{}')
  }

  const response = await call('/api/token', {
    method: 'POST',
    body: { code: 'c', redirect_uri: 'https://attacker.example.com/' },
  })

  assert.equal(response.status, 400)
  assert.equal((await response.json()).error, 'redirect_uri_not_allowed')
  assert.equal(called, false)
})

test('无 Origin 的 POST 被拒绝', async () => {
  const response = await call('/api/token', {
    method: 'POST',
    origin: null,
    body: { code: 'c', redirect_uri: REDIRECT_URI },
  })
  assert.equal(response.status, 403)
  assert.equal((await response.json()).error, 'forbidden_origin')
})

test('GET /api/token 返回 405', async () => {
  const response = await call('/api/token')
  assert.equal(response.status, 405)
  assert.equal((await response.json()).error, 'method_not_allowed')
})

test('非法 JSON 正文返回 400', async () => {
  const response = await call('/api/token', { method: 'POST', body: '{oops' })
  assert.equal(response.status, 400)
  assert.equal((await response.json()).error, 'invalid_request_body')
})

test('ALLOWED_ORIGINS=* 时接受任意来源', async () => {
  const upstream = stubGitHub({ access_token: 'gho_token', scope: '', token_type: 'bearer' })
  const response = await relay.fetch(
    new Request('https://relay.example.deno.dev/api/token', {
      method: 'POST',
      headers: { Origin: 'https://anything.example.net', 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'c', redirect_uri: 'https://anything.example.net/' }),
    }),
    { ...ENV, ALLOWED_ORIGINS: '*' },
  )
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://anything.example.net')
  assert.equal(upstream.calls, 1)
})

test('未知路径返回 404', async () => {
  const response = await call('/nope')
  assert.equal(response.status, 404)
})
