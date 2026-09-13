# 部署与配置指南

从零把这个站点跑起来，大约 10 分钟。

## 0. 前置要求

- Node.js 20 或更高版本（本地开发用；GitHub Actions 里会自动安装）
- 一个 GitHub 账户
- 本仓库的代码

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

站点会自动从这个地址推断仓库坐标，**无需任何环境变量**。使用自定义域名（Pages 的 Custom domain）时推断会失效，要按第 5 节显式配置 `VITE_GITHUB_OWNER` / `VITE_GITHUB_REPO`。

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

## 5.（可选）注册 OAuth App 以启用设备码登录

不做这一步站点也能用——用户可以在登录弹窗里粘贴 PAT。配置之后体验更好。

1. 打开 [github.com/settings/developers](https://github.com/settings/developers) → **OAuth Apps** → **New OAuth App**。
2. 填写：
   - **Application name**：随便，例如 `Hdssibal Arena`
   - **Homepage URL**：你的站点地址
   - **Authorization callback URL**：站点地址（设备码流程用不到回调，但表单必填）
3. 创建后复制 **Client ID**（不需要生成 client secret——设备码流程只用 Client ID）。
4. 在 `.env.local` 里填：

```
VITE_OAUTH_CLIENT_ID=Ov23liXXXXXXXXXXXXXX
VITE_OAUTH_SCOPES=public_repo
```

5. **在 GitHub Pages 上部署时需要让这个变量可见**：在仓库 **Settings → Secrets and variables → Actions → Variables** 添加同名变量 `VITE_OAUTH_CLIENT_ID`（和 `VITE_GITHUB_OWNER`、`VITE_GITHUB_REPO`，如果用了自定义域名），Vite 会在构建时把它们编进产物。

### 设备码流程的已知限制

`github.com/login/device/code` 与 `github.com/login/oauth/access_token` **不支持 CORS 预检请求（OPTIONS）**——这是 GitHub 官方明确说明的行为。本站只在「简单请求」的前提下调用它（`application/x-www-form-urlencoded` + 仅使用 CORS 安全列表内的请求头），因此**可能**在很多环境里正常工作，但无法保证。

如果登录弹窗里设备码流程失败，请切换「使用访问令牌」标签页：

1. 打开 [github.com/settings/tokens](https://github.com/settings/tokens)（Fine-grained tokens 推荐）
2. Fine-grained：Repository access 选本站仓库，Permissions → **Contents: Read and write**
3. 经典令牌：勾选 `public_repo`（公开仓库）或 `repo`（私有仓库）
4. 复制生成的令牌，粘贴进弹窗

令牌只存在你自己的浏览器 `localStorage` 里，页面直接请求 `api.github.com`，不经过任何第三方服务器。

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
| 设备码登录一直失败 | 见第 5 节的 CORS 限制，改用 PAT |

## 9. 升级路径

### 9.1 换成标准 OAuth Web Flow（推荐的第一步升级）

需要一个能保存 `client_secret` 并转发 `https://github.com/login/oauth/access_token` 的中间层，几十行代码即可，例如 Cloudflare Worker：

```
浏览器 → 跳转 github.com/login/oauth/authorize?client_id=...&code_challenge=...
GitHub → 回调到 Worker?code=...
Worker → 带 client_secret + code_verifier 换 access_token → 返回给前端
```

前端只需要把 `services/auth.ts` 里换成 `authorize` 跳转 + 回调处理，其余逻辑（store、权限判定、提交）完全复用。这样既保留了静态托管的全部优点，又摆脱了设备码的 CORS 限制。

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