# OAuth 中转层

把「GitHub 授权码 → 访问令牌」这一步从浏览器挪到服务端，让站点在前端保持纯静态的同时支持 GitHub 一键登录。

## 为什么必须有它

| 事实 | 后果 |
| --- | --- |
| `POST https://github.com/login/oauth/access_token` **不返回任何 `access-control-*` 响应头**，也不响应 `OPTIONS` 预检 | 浏览器里的 JS 读不到这个端点的响应，纯前端换不到令牌 |
| 官方文档把 `client_secret` 标为 **Required**，`code_verifier`（PKCE）只是 "strongly recommended" | PKCE 不能替代 secret，secret 必须存放在一个前端拿不到的地方 |
| 授权码只有 10 分钟有效期，且用一次就作废 | 中转层不需要持久化任何东西，无状态即可 |

因此这一层只做一件事：收下授权码，带上 `client_secret` 转发给 GitHub，把结果原样（去掉 secret）回给浏览器。它**不保存**令牌、**不记录**日志，`client_secret` 也永远不会出现在响应正文里。

## 部署到 Deno Deploy（推荐，不用装任何工具）

1. 打开 [dash.deno.com](https://dash.deno.com/) 并用 GitHub 账户登录。
2. **New Playground** → 把 [src/relay.ts](./src/relay.ts) 的全部内容粘贴进编辑器 → 保存。
3. 右上角 **Settings → Environment Variables**，添加三个变量：

   | 变量 | 值 |
   | --- | --- |
   | `GITHUB_CLIENT_ID` | OAuth App 的 Client ID |
   | `GITHUB_CLIENT_SECRET` | OAuth App 的 Client Secret |
   | `ALLOWED_ORIGINS` | 允许调用本站的来源，逗号分隔，例如 `https://your-name.github.io,http://localhost:5173` |

4. 保存后 playground 会得到一个 `https://<名字>.<你的用户名>.deno.dev` 域名，可随时在 Settings 里改成更好的名字。
5. 验证一下：

   ```bash
   curl https://<你的域名>/health
   # {"ok":true,"service":"hdssibal-arena-oauth-relay","configured":true,"allowedOriginCount":2}
   ```

   看到 `"configured":true` 就说明两个凭据都读到了。`allowedOriginCount` 是来源白名单的条数：为 `0` 时**任何**浏览器来源都拿不到 CORS 头（站点会登录失败），所以这个值必须至少是 1，或者填 `ALLOWED_ORIGINS=*` 表示不限制来源。

6. 把这个域名填进前端配置：

   ```
   # .env.local
   VITE_OAUTH_CLIENT_ID=Ov23liXXXXXXXXXXXXXX
   VITE_OAUTH_RELAY_URL=https://<你的域名>
   ```

## 备选：Cloudflare Workers

同一份代码在 Workers 上可以原样运行（环境变量读取做了双运行时兼容），仓库里已备好 [wrangler.toml](./wrangler.toml)：

```bash
npx wrangler deploy
npx wrangler secret put GITHUB_CLIENT_SECRET
```

`GITHUB_CLIENT_ID` 与 `ALLOWED_ORIGINS` 可以直接写在 `wrangler.toml` 的 `[vars]` 里，只有 secret 需要用 `secret put`。

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

然后把 `.env.local` 里的 `VITE_OAUTH_RELAY_URL=http://localhost:8787`。注意 GitHub OAuth App 的 **Authorization callback URL** 需要临时改成 `http://localhost:5173/`——GitHub 只允许登记一个回调地址，本地和生产不能同时生效。

## 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `OPTIONS` | `*` | 预检，返回 `204` 与 CORS 头 |
| `GET` | `/` | 服务说明与当前配置状态 |
| `GET` | `/health` | 健康检查，含 `secretConfigured` |
| `POST` | `/api/token` | 请求体 `{ code, code_verifier?, redirect_uri }`，返回 `{ access_token, scope, token_type }` |

出错时返回 `{ error, error_description }`，前端 `services/auth.ts` 会把常见错误码翻译成中文提示。

## 安全措施

- **来源白名单**：只有 `ALLOWED_ORIGINS` 里的 Origin 才会收到 CORS 头（`Vary: Origin`），其他来源的响应浏览器读不到。
- **不做开放代理**：只接受 `POST /api/token`；`GET /api/token` 返回 405；没有 `Origin` 头的 POST 直接 403。
- **`redirect_uri` 二次校验**：即使来源在白名单里，`redirect_uri` 的 origin 也必须同样在白名单内，防止把授权码引到别处。
- **请求体设上限**：非 JSON 或超过 4 KB 一律 400。
- **不泄露秘密**：只透传 GitHub 的 `error` / `error_description`，绝不回显 `client_secret`；所有响应带 `Cache-Control: no-store`。
- **无状态**：不写数据库、不打日志，令牌只在内存里过一手。

## 测试

```bash
cd relay
npm test        # node --test，14 个用例，不需要部署或联网
```

用例通过 stub `globalThis.fetch` 直接调用 handler，覆盖 CORS 白名单、缺 secret、secret 泄漏、`redirect_uri` 校验、405/400/404 等分支。
