/**
 * GitHub 登录相关的纯函数测试。
 *
 * src/services/auth.ts 与 src/utils/randomToken.ts 都不依赖路径别名，Node 可以直接
 * 用类型剥离运行（注意 import 必须写全 .ts 后缀）。
 * 用法：npm run test:unit
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { AuthError, buildRelayAuthorizeUrl, describeMissingScope, exchangeSessionForToken } from '../src/services/auth.ts'
import { randomToken } from '../src/utils/randomToken.ts'

/* --------------------------------------------------- buildRelayAuthorizeUrl */

test('授权地址指向中转层，并带上回跳地址与 state', () => {
  const url = new URL(
    buildRelayAuthorizeUrl({
      relayUrl: 'https://relay.example.com',
      redirectUri: 'https://user.github.io/repo/oauth/callback.html',
      state: 'nonce-1',
    }),
  )
  assert.equal(url.origin + url.pathname, 'https://relay.example.com/api/oauth/authorize')
  assert.equal(url.searchParams.get('redirect_uri'), 'https://user.github.io/repo/oauth/callback.html')
  assert.equal(url.searchParams.get('state'), 'nonce-1')
})

test('中转层地址结尾的斜杠不会拼出双斜杠', () => {
  const url = buildRelayAuthorizeUrl({
    relayUrl: 'https://relay.example.com///',
    redirectUri: 'https://user.github.io/repo/oauth/callback.html',
    state: 'nonce-1',
  })
  assert.ok(url.startsWith('https://relay.example.com/api/oauth/authorize?'), url)
})

test('scope 留空时不出现在查询串里', () => {
  const without = buildRelayAuthorizeUrl({
    relayUrl: 'https://relay.example.com',
    redirectUri: 'https://a.example.com/cb',
    state: 's',
  })
  assert.equal(without.includes('scope='), false)

  const withScope = buildRelayAuthorizeUrl({
    relayUrl: 'https://relay.example.com',
    redirectUri: 'https://a.example.com/cb',
    state: 's',
    scope: 'public_repo',
  })
  assert.ok(withScope.endsWith('&scope=public_repo'), withScope)
})

test('参数值被完整编码，不会破坏查询串', () => {
  const url = buildRelayAuthorizeUrl({
    relayUrl: 'https://relay.example.com',
    redirectUri: 'https://a.example.com/cb?x=1&y=2',
    state: 'a b&c',
  })
  assert.ok(url.includes('redirect_uri=https%3A%2F%2Fa.example.com%2Fcb%3Fx%3D1%26y%3D2'), url)
  assert.ok(url.includes('state=a%20b%26c'), url)
  assert.equal(new URL(url).searchParams.get('state'), 'a b&c')
})

/* --------------------------------------------------- exchangeSessionForToken */

/** 替换全局 fetch，收集调用参数，供断言使用。 */
function stubFetch(handler) {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init })
    return handler(String(input), init)
  }
  return {
    calls,
    restore() {
      globalThis.fetch = original
    },
  }
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

test('拿中转层签发的会话信封换取令牌，信封只放在请求体里', async () => {
  const stub = stubFetch(() =>
    jsonResponse({ access_token: 'gho_abc', scope: 'public_repo', token_type: 'bearer' }),
  )
  try {
    const result = await exchangeSessionForToken({
      relayUrl: 'https://relay.example.com/',
      session: 'sess.value',
    })
    assert.equal(result.token, 'gho_abc')
    assert.equal(result.scopes, 'public_repo')
    assert.equal(stub.calls.length, 1)
    assert.equal(stub.calls[0].url, 'https://relay.example.com/api/oauth/session')
    assert.equal(stub.calls[0].init.method, 'POST')
    assert.equal(JSON.parse(stub.calls[0].init.body).session, 'sess.value')
  } finally {
    stub.restore()
  }
})

test('中转层返回的错误码被翻译成中文提示', async () => {
  const stub = stubFetch(() =>
    jsonResponse({ error: 'session_origin_mismatch', error_description: 'nope' }, 403),
  )
  try {
    await assert.rejects(
      () => exchangeSessionForToken({ relayUrl: 'https://relay.example.com', session: 'x' }),
      (error) => {
        assert.ok(error instanceof AuthError)
        assert.equal(error.message, '登录凭据不属于本站，请重新登录。')
        return true
      },
    )
  } finally {
    stub.restore()
  }
})

test('会话过期与 state 不匹配共用同一条提示', async () => {
  for (const code of ['invalid_state', 'state_expired']) {
    const stub = stubFetch(() => jsonResponse({ error: code }, 400))
    try {
      await assert.rejects(
        () => exchangeSessionForToken({ relayUrl: 'https://relay.example.com', session: 'x' }),
        (error) => error.message.includes('重新登录'),
      )
    } finally {
      stub.restore()
    }
  }
})

test('无法识别的错误码回退到中转层给的描述', async () => {
  const stub = stubFetch(() =>
    jsonResponse({ error: 'brand_new_code', error_description: '中转层说这样不行' }, 400),
  )
  try {
    await assert.rejects(
      () => exchangeSessionForToken({ relayUrl: 'https://relay.example.com', session: 'x' }),
      (error) => error.message === '中转层说这样不行',
    )
  } finally {
    stub.restore()
  }
})

test('响应不是 JSON 时给出带状态码的兜底提示', async () => {
  const stub = stubFetch(() => new Response('<html>502</html>', { status: 502 }))
  try {
    await assert.rejects(
      () => exchangeSessionForToken({ relayUrl: 'https://relay.example.com', session: 'x' }),
      (error) => {
        assert.equal(error.message, '登录中转服务返回了 HTTP 502，请重试或改用访问令牌登录。')
        return true
      },
    )
  } finally {
    stub.restore()
  }
})

test('连不上中转层时提示网络问题', async () => {
  const stub = stubFetch(() => {
    throw new TypeError('Failed to fetch')
  })
  try {
    await assert.rejects(
      () => exchangeSessionForToken({ relayUrl: 'https://relay.example.com', session: 'x' }),
      (error) => error.message === '无法连接登录中转服务，请检查网络后重试。',
    )
  } finally {
    stub.restore()
  }
})

/* ------------------------------------------------------------ describeMissingScope */

test('拥有可写仓库的权限时不再提示', () => {
  assert.equal(describeMissingScope('public_repo'), null)
  assert.equal(describeMissingScope('repo,read:user'), null)
  assert.equal(describeMissingScope('contents'), null)
})

test('只有只读权限时提示需要可写权限', () => {
  const message = describeMissingScope('read:user')
  assert.ok(message && message.includes('可写仓库内容'), message)
})

test('拿不到 scope 信息时不误报', () => {
  assert.equal(describeMissingScope(null), null)
  assert.equal(describeMissingScope(''), null)
  assert.equal(describeMissingScope('   '), null)
})

/* ---------------------------------------------------------------- randomToken */

test('随机 state 是 base64url 且长度符合预期', () => {
  const token = randomToken()
  assert.match(token, /^[A-Za-z0-9_-]+$/)
  assert.equal(token.length, 22) // 16 字节 base64url 去掉补位
})

test('随机 state 每次都不一样', () => {
  const seen = new Set()
  for (let index = 0; index < 200; index += 1) seen.add(randomToken(8))
  assert.equal(seen.size, 200)
})

test('拒绝非正整数字节数', () => {
  for (const bad of [0, -1, 1.5, Number.NaN]) {
    assert.throws(() => randomToken(bad), /正整数长度/)
  }
})
