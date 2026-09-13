# Hdssibal 比赛会场

一个托管在 **GitHub Pages** 上的在线比赛会场：用 GitHub 账户登录，参赛者自己上传/修改作品，活动页以「封面图 + 标题 + 作者」展示作品，管理员可以创建活动、清理作品。

没有服务器、没有数据库、没有账号系统——**仓库本身就是数据库**。

- 站点：纯静态 SPA（Vue 3 + Vite），构建产物直接部署到 GitHub Pages
- 后端：GitHub REST API（Contents API 读写 `data/` 与 `public/`）
- 数据：`data/**/*.json` 在构建时通过 `import.meta.glob` 打进产物，访客浏览页面 **零 API 调用**（不受 60 次/小时的匿名限流影响，秒开）
- 权限：管理员 = 仓库 `admin` 权限，或 `data/config.json` 里的 `admins` 白名单

## 功能与代码位置

| 需求 | 实现位置 |
| --- | --- |
| ① GitHub 账户登录 | [LoginDialog.vue](./src/components/LoginDialog.vue)、[stores/auth.ts](./src/stores/auth.ts)、[services/auth.ts](./src/services/auth.ts) |
| ② 上传 / 修改自己的作品 | [MyWorksView.vue](./src/views/MyWorksView.vue)、[components/WorkForm.vue](./src/components/WorkForm.vue)、[services/works.ts](./src/services/works.ts)、[services/images.ts](./src/services/images.ts) |
| ③ 主页显示最近活动 | [HomeView.vue](./src/views/HomeView.vue)、[components/ActivityFeed.vue](./src/components/ActivityFeed.vue)、[utils/activity.ts](./src/utils/activity.ts) |
| ④ 活动页展示作品（封面 + 标题 + 作者） | [EventDetailView.vue](./src/views/EventDetailView.vue)、[components/WorkCard.vue](./src/components/WorkCard.vue) |
| ⑤ 管理员添加活动 / 删除作品 | [AdminView.vue](./src/views/AdminView.vue)、[services/events.ts](./src/services/events.ts) |

页面清单：`/` 首页、`/events` 活动列表、`/events/:id` 活动详情、`/works/:id` 作品详情、`/me` 我的作品、`/admin` 管理后台、`/guide` 参与指南（hash 路由，`#/events` 这种形式）。

## 快速开始

```bash
npm install
cp .env.example .env.local   # 填上仓库坐标；部署到 Pages 时不需要
npm run dev                  # http://localhost:5173
```

常用命令：

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 本地开发服务器 |
| `npm run build` | 类型检查 + 生产构建（产物在 `dist/`） |
| `npm run preview` | 预览生产构建 |
| `npm run typecheck` | 只跑 `vue-tsc` |
| `npm run validate:data` | 校验 `data/` 下的 JSON 结构与引用（CI 会跑） |

> ⚠️ 本项目固定使用 **TypeScript 5.9**。`vue-tsc` 目前还不兼容 TypeScript 7（`tsgo` 不再导出 `./lib/tsc`），升级 `typescript` 会导致 `npm run typecheck` 直接崩溃。

## 部署到 GitHub Pages

完整步骤见 [docs/SETUP.md](./docs/SETUP.md)，最短路径：

1. 把本仓库推到 GitHub。
2. **Settings → Pages → Source 选 `GitHub Actions`**。
3. 推送 `main` 分支，[deploy.yml](./.github/workflows/deploy.yml) 会自动构建并发布。

仓库坐标无需配置：站点会从 `<user>.github.io/<repo>` 推断 owner 与 repo。使用自定义域名时，请在 `.env.local`（或仓库变量）里显式指定 `VITE_GITHUB_OWNER` / `VITE_GITHUB_REPO`。

## 登录方式

站点提供两种登录，UI 上是两个标签页：

**A. 个人访问令牌（PAT）—— 默认可用、100% 可靠**

到 [github.com/settings/tokens](https://github.com/settings/tokens) 生成 **Fine-grained token**，仓库选本站仓库，权限给 `Contents: Read and write`（经典令牌则勾 `public_repo`，私有仓库勾 `repo`）。粘贴即可登录。

**B. 设备码登录（Device Flow）—— 需要先注册 OAuth App**

在 GitHub 上注册一个 **OAuth App**（无需 client secret，设备码流程只用到 Client ID），把 Client ID 写进 `VITE_OAUTH_CLIENT_ID`。用户在弹窗里看到 8 位用户码，去 `github.com/login/device` 输入并授权。

已知限制：`github.com/login/*` 端点**不支持 CORS 预检（OPTIONS）**，所以设备码流程只在「简单请求」下可能通过，部分浏览器/网络环境会失败。失败时弹窗会引导改用 PAT——这是设计上的兜底，不是 bug。要彻底摆脱这个限制，见文末「升级路径」。

令牌保存在 `localStorage`（键名 `hdssibal:token`），只在浏览器里调用 `api.github.com`，不经过任何第三方服务器。

## 数据格式（`data/`）

```
data/
├─ config.json                 # 站点信息、管理员白名单、动态条数
├─ events/<eventId>.json       # 一个活动一个文件，文件名必须等于 id
└─ works/<workId>.json         # 一件作品一个文件，文件名必须等于 id
public/works/<workId>/cover.*  # 作品封面
public/events/<eventId>/cover.*# 活动封面
```

作品：

```json
{
  "id": "demo-work-f3k9",
  "eventId": "2026-demo-arena",
  "title": "示例作品：像素星图",
  "summary": "一句话简介",
  "description": "Markdown 正文（不解析原始 HTML）",
  "cover": "works/demo-work-f3k9/cover.webp",
  "tags": ["像素画"],
  "links": [{ "label": "GitHub", "url": "https://github.com" }],
  "author": { "login": "octocat", "id": 583231, "name": "The Octocat" },
  "createdAt": "2026-01-06T02:30:00.000Z",
  "updatedAt": "2026-01-06T02:30:00.000Z"
}
```

活动：`status` 取 `draft | upcoming | open | closed | archived`，`acceptSubmissions` 控制是否开放投稿。

`npm run validate:data` 会检查：JSON 可解析、id 与文件名一致、`eventId` 外键存在、封面文件存在、封面路径前缀合法、时间是 ISO 8601、`status` 是合法枚举。

新增作品**不需要手写 JSON**：登录后到 `/me` 上传封面、填表单即可，前端会自动生成文件、压缩封面并提交到仓库。

## 权限模型

| 角色 | 能做什么 | 怎么获得 |
| --- | --- | --- |
| 访客 | 浏览活动与作品 | 直接访问 |
| 参赛者 | 提交/修改/删除自己的作品 | 被邀请为仓库协作者（`push` 权限） |
| 管理员 | 创建与编辑活动、删除任意作品 | 仓库 `admin` 权限，或在 `config.json` 的 `admins` 里列名 |

「只能修改自己的作品」是**前端约束**：协作者在 Git 层面本来就有写权限，绕开网页就能改别人的文件。要真正强制，需要走 PR + 分支保护，或改用独立后端（见「升级路径」）。

## 已知限制

- **写完要等一次构建**：别人提交的作品，公众要等 Actions 重新部署（约 30 秒–1 分钟）才能看到；作者本人在 `/me` 里是立刻可见的（那条路径直接读 API）。
- **仓库体积**：所有封面都在仓库里，图片会累积。单张封面已在浏览器端压缩到 ≤ 2 MB（目标 600 KB，最长边 1600 px），GIF 不重编码，不接受 SVG 作为上传格式。
- **匿名限流**：访客浏览已打包的数据，不消耗 API 限额；登录用户的操作走自己的令牌。
- **设备码登录**受 CORS 限制，见上文。

## 升级路径

1. **标准 OAuth Web Flow + PKCE**：需要能安全保存 `client_secret` 并代理 `github.com/login/oauth/access_token` 的中间层。用一个 Cloudflare Worker 或 Vercel/Netlify Function（几十行代码）就能把登录体验变成「点一下按钮」，同时保留纯静态前端。
2. **提交走 PR**：把参赛者的写操作改成「fork → 提 PR」，配合分支保护与 `CODEOWNERS`，可以真正强制「只能改自己的作品」，并给管理员一个 review 关卡。
3. **换掉 import.meta.glob**：数据量变大（>几千件作品）时，改成构建期生成索引（或分页 JSON），避免首屏 bundle 过大。
4. **Git LFS / 外部图床**：封面增长到影响仓库大小时，把图片转移到 LFS 或对象存储，`cover` 字段已支持外部 URL。

## 推荐的开发辅助（插件 / 工具）

**VS Code 扩展**（`.vscode/extensions.json` 已推荐）：

- `Vue.volar`（Vue - Official）：模板类型检查、`<script setup>` 智能提示，**必装**
- `usernamehw.errorlens`：行内显示错误，改类型错误时非常省事
- `github.vscode-github-actions`：校验并预览 workflow 语法
- `dbaeumer.vscode-eslint` / `esbenp.prettier-vscode`：代码规范（需自行添加 ESLint/Prettier 配置）
- `streetsidesoftware.code-spell-checker`：拼写检查

**npm 包（按需添加）**：

- `@octokit/rest` —— 想要更完整的 GitHub API 封装、重试与分页时替换手写的 `fetch` 层
- `@vueuse/core` —— 表单、剪贴板、本地存储等常用组合式工具
- `unplugin-vue-components` / `unplugin-auto-import` —— 自动导入组件与 API，减少样板代码
- `vitest` —— 给 `utils/`、`services/` 写单元测试
- `dayjs` —— 更灵活的日期格式化（当前用的是自写的 `utils/format.ts`）

**GitHub 侧**：

- Actions（已配好 `deploy.yml` / `validate-data.yml`）、Pages
- Dependabot（`.github/dependabot.yml`，自动升级依赖）
- 分支保护 + `CODEOWNERS`（走 PR 流程时）
- Issue / PR 模板（收集投稿与 bug 报告）

## 目录结构

```
├─ data/                     # 数据库：站点配置、活动、作品
├─ public/                   # 封面等静态资源（原样复制进产物）
├─ scripts/validate-data.mjs # 零依赖的数据校验脚本
├─ src/
│  ├─ components/            # WorkCard、EventCard、表单、弹窗……
│  ├─ composables/           # useToast、useLoginDialog
│  ├─ router/                # hash 路由
│  ├─ services/              # github / auth / works / events / images / catalog / markdown
│  ├─ stores/                # Pinia：auth、catalog
│  ├─ styles/main.css        # 设计系统（暗色）
│  ├─ utils/                 # 格式化、编码、身份、动态
│  └─ views/                 # 七个页面
└─ .github/workflows/        # 部署 + 数据校验
```