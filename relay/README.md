# OAuth 中转层

把「GitHub 授权码 → 访问令牌」这一步从浏览器挪到服务端，让站点在前端保持纯静态的同时支持 GitHub 一键登录。

## 为什么必须有它

| 事实 | 后果 |
| --- | --- |
| `POST https://github.com/login/oauth/access_token` **不返回任何 `access-control-*` 响应头**，也不响应 `OPTIONS` 预检 | 浏览器里的 JS 读不到这个端点的响应，纯前端换不到令牌 |
| 官方文档把 `client_secret` 标为 **Required**，`code_verifier`（PKCE）只是 "strongly recommended" | PKCE 不能替代 secret，secret 必须存放在一个前端拿不到的地方 |
| 授权码只有 10 分钟有效期，且用一次就作废 | 中转层不需要持久化任何东西，无状态即可 |

因此这一层只做三件事：

1. 校验**站点回跳地址**是否在白名单里，然后把它连同随机 `state` 一起**加密成一个信封**，充当 GitHub 的 `state`（站点拿不到、也改不动里面的内容）；
2. 接住 GitHub 的回调，解密信封，带上 `client_secret` 把授权码换成令牌，再把令牌封成 **5 分钟有效、且只认发起来源**的 `session`；
3. 站点用 `POST /api/oauth/session` 把 `session` 换成明文令牌。

它**不保存**令牌（`session` 本身就是加密信封，服务端不留任何状态）、**不记录**日志，`client_secret` 也永远不会出现在响应正文里。

设计参考 [giscus](https://github.com/giscus/giscus)：GitHub 侧只登记一个固定回调地址，回跳目标放在加密的 `state` 里，所以同一份中转层能服务任意多个站点、fork 与本地开发，不需要为每个站点改 GitHub 配置或加 CORS 例外。

## 部署到 Deno Deploy（推荐，不用装任何工具）

1. 打开 [dash.deno.com](https://dash.deno.com/) 并用 GitHub 账户登录。
2. **New Playground** → 把 [src/relay.ts](./src/relay.ts) 的全部内容粘贴进编辑器 → 保存。
3. 右上角 **Settings → Environment Variables**，添加四个变量：

   | 变量 | 值 |
   | --- | --- |
   | `GITHUB_CLIENT_ID` | OAuth App 的 Client ID |
   | `GITHUB_CLIENT_SECRET` | OAuth App 的 Client Secret |
   | `ALLOWED_ORIGINS` | 允许登录的**站点**来源，逗号分隔，例如 `https://your-name.github.io,http://localhost:5173` |
   | `STATE_SECRET`（可选） | 加密 state 用的密钥，任意长随机串。不填则用 `GITHUB_CLIENT_SECRET` 派生 |

   同时把 GitHub OAuth App 的 **Authorization callback URL** 设为 `https://<你的域名>/api/oauth/authorized`。

4. 保存后 playground 会得到一个 `https://<名字>.<你的用户名>.deno.dev` 域名，可随时在 Settings 里改成更好的名字。
5. 验证一下：

   ```bash
   curl https://<你的域名>/health
   # {"ok":true,"service":"hdssibal-arena-oauth-relay","configured":true,
   #  "allowedOriginCount":2,"allowsAnyOrigin":false,
   #  "envelopeKeyFrom":"STATE_SECRET + GITHUB_CLIENT_SECRET",
   #  "callbackUrl":"https://<你的域名>/api/oauth/authorized"}
   ```

   看到 `"configured":true` 就说明两个凭据都读到了。`allowedOriginCount` 是来源白名单的条数：为 `0` 时**任何**站点都无法登录，所以这个值必须至少是 1。

   ⚠️ **不要用 `ALLOWED_ORIGINS=*`**：`session` 里装的就是访问令牌，来源白名单是它唯一的防线（`session` 内嵌发起来源，`POST /api/oauth/session` 会核对请求 `Origin`）。`*` 意味着任何网站都能把别人骗来的 `session` 换成令牌——这是本层唯一需要严防的漏洞。`/health` 会如实报告 `allowsAnyOrigin`，中转层也会打警告日志。

6. 把这个域名填进前端配置：

   ```
   # .env.local
   VITE_OAUTH_RELAY_URL=https://<你的域名>
   ```

   前端不需要 Client ID / Client Secret，它们只存在于中转层的环境变量里。

## 备选：Cloudflare Workers

同一份代码在 Workers 上可以原样运行（环境变量读取做了双运行时兼容），仓库里已备好 [wrangler.toml](./wrangler.toml)：

```bash
npx wrangler deploy
npx wrangler secret put GITHUB_CLIENT_SECRET
```

`GITHUB_CLIENT_ID`、`ALLOWED_ORIGINS`（以及可选的 `STATE_SECRET`）可以直接写在 `wrangler.toml` 的 `[vars]` 里，只有 secret 需要用 `secret put`。

## 本地联调

想在没有账号的情况下验证整条链路（前端 → 中转层 → GitHub），用仓库里自带的 Node 适配器：

```bash
cd relay
GITHUB_CLIENT_ID=xxx GITHUB_CLIENT_SECRET=xxx ALLOWED_ORIGINS=http://localhost:5173 npm run dev
# 中转层跑在 http://localhost:8787
```

Windows PowerShell 下换成：

```powershell
$env:GITHUB_CLIENT_ID='xxx'; $env:GITHUB_CLIENT_SECRET='xxx'; $env:ALLOWED_ORIGINS='http://localhost:5173'; node dev.mjs
```

然后把 `.env.local` 里的 `VITE_OAUTH_RELAY_URL=http://localhost:8787`。本地开发不需要改 GitHub 上的回调地址：它始终指向中转层，回跳目标由前端每次请求时通过 `redirect_uri` 指定，而 `http://localhost:5173` 只要出现在 `ALLOWED_ORIGINS` 里就会被放行。

## 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `OPTIONS` | `*` | 预检，返回 `204` 与 CORS 头 |
| `GET` | `/` | 服务说明与当前配置状态 |
| `GET` | `/health` | 健康检查，含 `configured` / `allowsAnyOrigin` / `callbackUrl` |
| `GET` | `/api/oauth/authorize` | 参数 `redirect_uri`、`state`、`scope?`；校验来源后 302 到 GitHub |
| `GET` | `/api/oauth/authorized` | GitHub 的回调端点；解密 state → 换令牌 → 302 回站点 |
| `POST` | `/api/oauth/session` | 请求体 `{ session }`，返回 `{ access_token, scope, token_type }` |

两个 `GET` 端点是**顶层导航**（浏览器地址栏跳转，不带 `Origin` 头），所以它们只校验 `redirect_uri` 的来源，不要求 `Origin`；只有 `POST /api/oauth/session` 需要来源在白名单内。

出错时返回 `{ error, error_description }`，前端 `services/auth.ts` 会把常见错误码翻译成中文提示。

## 安全措施

- **`redirect_uri` 来源白名单**：`/api/oauth/authorize` 只接受白名单内的来源，且只允许 https（`localhost` / `127.0.0.1` / `[::1]` 例外）、不允许带凭据或 hash。这是本层唯一的安全边界——放开了就等于把令牌送给任意网站。
- **加密 state 信封**：站点回跳地址与随机 nonce 用 HKDF-SHA256 派生密钥 + AES-GCM 加密后当 `state` 使用，站点改不动、也读不到别人的内容；信封自带 10 分钟过期时间。
- **加密 session 信封**：令牌封进 5 分钟有效、内嵌发起来源的 `session`；`POST /api/oauth/session` 会校验请求 `Origin` 与之一致（纵深防御）。
- **明文令牌不进地址栏**：回跳 URL 里只有 `session`，站点再用它换令牌。
- **CORS 来源白名单**：只有 `ALLOWED_ORIGINS` 里的 Origin 才会收到 CORS 头（`Vary: Origin`），其他来源的响应浏览器读不到。
- **不做开放代理**：只接受上表列出的路径，`GET /api/oauth/session` 返回 405。
- **请求体设上限**：非 JSON 或超过 4 KB 一律 400。
- **不泄露秘密**：只透传 GitHub 的 `error` / `error_description`，绝不回显 `client_secret`；所有响应带 `Cache-Control: no-store`，回跳响应另带 `Referrer-Policy: no-referrer`。
- **无状态**：不写数据库、不打日志，令牌只随加密信封经过服务端，不做任何存储。

## 测试

```bash
cd relay
npm test        # node --test，28 个用例，不需要部署或联网
```

用例通过 stub `globalThis.fetch` 直接调用 handler，覆盖 CORS 白名单、缺 secret、secret 泄漏、`redirect_uri` 校验、state 信封的篡改 / 过期 / 换密钥、换令牌失败、session 来源不匹配、405/400/404 等分支。
