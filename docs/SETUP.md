# 部署与配置指南

从零把这个站点跑起来，大约 10 分钟；再加上第 5 节的 GitHub 一键登录配置，约 15 分钟。

## 0. 前置要求

- Node.js 20 或更高版本（本地开发用；GitHub Actions 里会自动安装）
- 一个 GitHub 账户
- 本仓库的代码
- （可选）[dash.deno.com](https://dash.deno.com/) 账户——只有启用 GitHub 一键登录时才需要，见第 5 节

## 1. 推送到 GitHub

```bash
git init
git add .
git commit -m "chore: 初始化比赛会场"
git branch -M main
git remote add origin https://github.com/<你的用户名>/<仓库名>.git
git push -u origin main
```

仓库可以设为 **public**（推荐，Pages 免费且访客不需要授权）或 private（需要 GitHub Pro 才能用 Pages）。

## 2. 打开 GitHub Pages

**Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。

不要选 `Deploy from a branch`——本站的产物需要先经过 Vite 构建，分支部署只会直接发布源码。

推送后到 **Actions** 标签页看 `Deploy to GitHub Pages` 这条 workflow。绿色的勾出现后，站点地址就是：

```
https://<你的用户名>.github.io/<仓库名>/
```

站点会自动从这个地址推断仓库坐标，**无需任何环境变量**。使用自定义域名（Pages 的 Custom domain）时推断会失效，要按第 3 节显式配置 `VITE_GITHUB_OWNER` / `VITE_GITHUB_REPO`（部署时通过 **Actions → Variables** 注入，见 5.3）。

> 首次部署如果报 `Get Pages site failed` / `Not Found`，回到 Settings → Pages 确认 Source 已经切成 GitHub Actions，然后重跑 workflow。

## 3. 本地开发

```bash
npm install
cp .env.example .env.local
```

编辑 `.env.local`：

```
VITE_GITHUB_OWNER=你的用户名
VITE_GITHUB_REPO=仓库名
VITE_GITHUB_BRANCH=main
```

```bash
npm run dev     # http://localhost:5173
```

本地没有 `<user>.github.io` 域名可推断，所以这两个变量是必需的；否则页面顶部会显示一条「仓库未配置」的告警。

## 4. 把参赛者加为协作者

本站的写入走「用户自己的令牌 + GitHub API」，因此每位参赛者都必须是仓库协作者：

**Settings → Collaborators → Add people**，邀请对方的 GitHub 账户，权限用默认的 **Write**。

对方接受邀请后就能在 `/me` 页面上传作品了。没有写权限的用户可以登录、可以浏览，但提交时会收到 403。

## 5.（可选）配置 GitHub 一键登录

不做这一步站点也能用——用户可以在登录弹窗里粘贴 PAT。配置之后，用户点一下按钮就能登录。

一键登录需要**两件事**：一个 GitHub OAuth App（提供身份），和一份部署在服务端的中转层（持有 `client_secret` 并完成授权码换令牌）。

### 5.1 注册 OAuth App

1. 打开 [github.com/settings/developers](https://github.com/settings/developers) → **OAuth Apps** → **New OAuth App**。
2. 填写：
   - **Application name**：随便，例如 `Hdssibal Arena`
   - **Homepage URL**：你的站点地址
   - **Authorization callback URL**：**生产站点的根地址**，例如 `https://your-name.github.io/hdssibal/`。这是唯一允许的回调地址，本地开发时要临时改成 `http://localhost:5173/`。
3. 创建后复制 **Client ID**，再点 **Generate a new client secret** 生成 **Client Secret**（只显示一次，先存好）。

> ⚠️ 回调地址必须和站点的 `location.origin + location.pathname` 完全一致（含结尾斜杠）。GitHub 只允许登记一个地址，末尾斜杠不一致也会被拒绝。

### 5.2 部署中转层

GitHub 的令牌端点**不支持 CORS 预检、并且强制要求 `client_secret`**（PKCE 不能替代），所以「授权码 → 令牌」这一步必须由服务端完成。仓库里的 [relay/](../relay) 就是这个中转层，几十行代码，部署到 Deno Deploy 不需要装任何工具：

1. 打开 [dash.deno.com](https://dash.deno.com/) 用 GitHub 登录 → **New Playground**。
2. 把 [relay/src/relay.ts](../relay/src/relay.ts) 的内容整份粘贴进去并保存。
3. **Settings → Environment Variables** 添加：
   - `GITHUB_CLIENT_ID` = 上一步的 Client ID
   - `GITHUB_CLIENT_SECRET` = 上一步的 Client Secret
   - `ALLOWED_ORIGINS` = `https://your-name.github.io,http://localhost:5173`（逗号分隔；**漏配会导致登录被拒绝**）
4. 拿到 `https://<名字>.<用户名>.deno.dev` 域名，用 `curl https://<域名>/health` 确认 `"configured":true`。

细节、Cloudflare Workers 备选方案与本地联调方式见 [relay/README.md](../relay/README.md)。

### 5.3 填前端变量

在 `.env.local`（本地）里填：

```
VITE_OAUTH_CLIENT_ID=Ov23liXXXXXXXXXXXXXX
VITE_OAUTH_RELAY_URL=https://<你的域名>
VITE_OAUTH_SCOPES=public_repo
```

在 GitHub Pages 上部署时，这些变量要从仓库变量注入：**Settings → Secrets and variables → Actions → Variables** 里添加同名的 `VITE_OAUTH_CLIENT_ID` 与 `VITE_OAUTH_RELAY_URL`（用自定义域名的话还有 `VITE_GITHUB_OWNER`、`VITE_GITHUB_REPO`），[deploy.yml](../.github/workflows/deploy.yml) 的 build 步骤已经把这些变量接上了。

两者缺任一，登录弹窗都会提示「尚未配置一键登录」并引导用户改用 PAT——不会白屏，也不会静默失败。

### 5.4 一键登录失败时

弹窗会在 OAuth 回跳失败时自动打开并显示原因。常见情况：

| 提示 | 原因 |
| --- | --- |
| 已取消 GitHub 授权 | 用户在授权页点了 Cancel，重新登录即可 |
| 登录校验失败（state 不匹配） | 回跳时 `sessionStorage` 里的待验证数据已丢失（换了标签页、清了站点数据），重新登录 |
| 中转服务的 Client ID / Client Secret 配置不正确 | 中转层的两个环境变量没设对，或 OAuth App 的 secret 被重新生成过 |
| 中转服务拒绝了本站的来源 | `ALLOWED_ORIGINS` 没包含当前访问的域名（本地开发时最容易漏 `http://localhost:5173`） |
| 授权码无效或已过期 | 授权码只有 10 分钟有效期且用一次即废；刷新页面重试 |
| 无法连接登录中转服务 | 中转层没部署、域名填错，或被网络拦截 |

**任何时候都可以改用访问令牌登录**：登录弹窗的第二个标签页。

1. 打开 [github.com/settings/tokens](https://github.com/settings/tokens)（Fine-grained tokens 推荐）
2. Fine-grained：Repository access 选本站仓库，Permissions → **Contents: Read and write**
3. 经典令牌：勾选 `public_repo`（公开仓库）或 `repo`（私有仓库）
4. 复制生成的令牌，粘贴进弹窗

令牌只存在你自己的浏览器 `localStorage` 里，页面直接请求 `api.github.com`，不经过任何第三方服务器；中转层只在登录那一瞬间经手授权码，看不到也存不下令牌。

## 6. 管理员

满足任一条件即为管理员：

- 对本站仓库拥有 **admin** 权限（仓库所有者天然满足）
- 登录名出现在 `data/config.json` 的 `admins` 数组里

```json
{
  "site": { "name": "Hdssibal 比赛会场" },
  "admins": ["your-github-username", "co-admin"],
  "activityLimit": 12
}
```

`admins` 只是便利手段，**不是安全边界**：真正的权限由仓库的写权限决定。要防止有人直接改 `config.json` 给自己加管理权限，请启用分支保护，让主分支的变更必须经过 PR review。

管理员登录后访问 `/admin`，可以：

- 新建 / 编辑活动
- 删除任意作品（连同封面文件）
- 删除活动（活动下还有作品时会要求二次确认）

## 7. 数据维护

除了通过网页提交，也可以直接改仓库文件（改完 push 即触发重新部署）：

| 文件 | 说明 |
| --- | --- |
| `data/config.json` | 站点名称、标语、管理员白名单、动态条数上限 |
| `data/events/<id>.json` | 活动。`status`：`draft`/`upcoming`/`open`/`closed`/`archived`；`acceptSubmissions` 控制能否投稿 |
| `data/works/<id>.json` | 作品。`eventId` 必须指向存在的活动 |
| `public/<封面路径>` | 封面图，`cover` 字段写相对 `public/` 的路径，例如 `works/abc/cover.webp` |

**文件名必须等于文件里的 `id`**，这是校验脚本的硬性要求。

提交前先本地校验：

```bash
npm run validate:data
```

CI 里 `Validate data` workflow 会在 `data/**` 或 `public/**` 变更时自动跑同一个脚本，格式错误会让 PR 变成红色。

删除作品时要同时删掉 `public/` 下对应的封面目录，否则文件会一直留在仓库里。

## 8. 故障排查

| 现象 | 原因与处理 |
| --- | --- |
| 页面顶部提示「仓库未配置」 | 本地开发没写 `.env.local`，或部署在自定义域名下但没配 Actions Variables |
| 提交作品报 403 | 当前账户不是仓库协作者，或令牌权限不足（Fine-grained 需要 `Contents: Read and write`） |
| 提交作品报 409 / 422 | 文件已存在（id 撞车，刷新页面重试）或写入内容不合法；`services/github.ts` 会把 GitHub 的原始报错翻译成中文提示 |
| 提交成功但别人看不到 | 正常：访客读的是构建产物，等 Actions 部署完（约 30 秒–1 分钟）；作者本人在 `/me` 立刻可见 |
| API 限流提示 | 匿名请求限额 60 次/小时。登录后使用自己的令牌，限额 5000 次/小时 |
| 部署失败 `Get Pages site failed` | Settings → Pages 的 Source 没设成 GitHub Actions |
| `npm run typecheck` 崩溃（`ERR_PACKAGE_PATH_NOT_EXPORTED`） | 误装了 TypeScript 7。执行 `npm i -D typescript@5.9.3` 回到 5.9 |
| 一键登录失败 | 见第 5.4 节的排查表；随时可改用 PAT 登录 |

## 9. 升级路径

### 9.1 把中转层换成自控平台

`relay/src/relay.ts` 与 Cloudflare Workers 同构（[wrangler.toml](../relay/wrangler.toml) 已备好），想换平台、绑自定义域名，或把中转层和站点放进同一个 Cloudflare 账户时直接搬代码即可——环境变量的读取已经兼容 Deno 与 Workers 两套运行时。

流程本身不需要改：

```
浏览器 → 跳转 github.com/login/oauth/authorize?client_id=...&code_challenge=...
GitHub  → 回调到站点根地址?code=...&state=...
浏览器 → POST 中转层 /api/token { code, code_verifier, redirect_uri }
中转层 → 带 client_secret + code_verifier 换 access_token → 返回给前端
```

### 9.2 换成 GitHub App

OAuth App 的权限只能按 scope 粗粒度授权（本站要的是 `public_repo`，即「所有公开仓库的写权限」）。GitHub App 可以做到按仓库安装授权，权限更收敛。实际上仍是同一套授权码流程，改动集中在两处：中转层换成 App 的 `client_id` / `client_secret`，以及前端校验身份时改用 App 的安装接口（`GET /installation/repositories`）来确定可用仓库，而不是用 `/user/repos`。

### 9.2 投稿走 PR

把 `services/works.ts` 的提交目标从 `main` 换成一个分支 + 自动开 PR（GitHub API 支持在提交时 `createPullRequest`）。配合：

- 分支保护规则：`main` 需要 review
- `CODEOWNERS`：`data/works/**` 交由管理员 review
- CI：`Validate data` 已经就位

这样「只能改自己的作品」就从约定变成强制，管理员也多了一个审核关卡。

### 9.3 规模变大之后

- 作品数量到几千条时，把 `import.meta.glob` 换成构建期生成的索引/分页 JSON
- 仓库体积变大时，封面迁移到 Git LFS 或对象存储（`cover` 已支持完整 URL）
- 需要搜索、榜单、投票等动态能力时，把 `data/` 之外的状态交给 Cloudflare D1 / Supabase，前端仍然可以纯静态