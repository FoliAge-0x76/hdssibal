/**
 * 本地运行中转层（不需要 Deno / Cloudflare 账号）。
 *
 *   GITHUB_CLIENT_ID=xxx GITHUB_CLIENT_SECRET=yyy ALLOWED_ORIGINS=http://localhost:5173 node relay/dev.mjs
 *
 * Windows PowerShell 写法：
 *   $env:GITHUB_CLIENT_ID='xxx'; $env:GITHUB_CLIENT_SECRET='yyy'; $env:ALLOWED_ORIGINS='http://localhost:5173'; node relay/dev.mjs
 *
 * 启动后把 .env.local 里的 VITE_OAUTH_RELAY_URL 指向 http://localhost:8787 即可联调完整登录流程。
 */
import { createServer } from 'node:http'
import relay from './src/relay.ts'

const port = Number(process.env.PORT ?? 8787)

const server = createServer(async (nodeRequest, nodeResponse) => {
  const chunks = []
  for await (const chunk of nodeRequest) chunks.push(chunk)
  const payload = chunks.length ? Buffer.concat(chunks) : undefined

  const method = nodeRequest.method ?? 'GET'
  const hasBody = payload && payload.length > 0 && method !== 'GET' && method !== 'HEAD'

  const request = new Request(new URL(nodeRequest.url ?? '/', `http://${nodeRequest.headers.host}`), {
    method,
    headers: nodeRequest.headers,
    body: hasBody ? payload : undefined,
  })

  const response = await relay.fetch(request, process.env)

  nodeResponse.writeHead(response.status, Object.fromEntries(response.headers))
  const buffer = Buffer.from(await response.arrayBuffer())
  nodeResponse.end(buffer.length ? buffer : undefined)
})

server.listen(port, () => {
  const configured = Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET)
  console.log(`OAuth 中转层已启动：http://localhost:${port}`)
  console.log(`  secret 已配置：${configured ? '是' : '否（请设置 GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET）'}`)
  console.log(`  允许的来源：${process.env.ALLOWED_ORIGINS ?? '(未设置，将拒绝所有来源)'}`)
})
