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

**A. GitHub 一键登录（OAuth 授权码 + PKCE）—— 推荐，需要一次性配置**

用户点按钮 → 跳转 GitHub 授权页 → 确认后自动回跳完成登录。配置两步：

1. 注册一个 **OAuth App**（[github.com/settings/developers](https://github.com/settings/developers) → New OAuth App），**Authorization callback URL** 填生产站点地址（如 `https://<user>.github.io/<repo>/`），拿到 Client ID 填进 `VITE_OAUTH_CLIENT_ID`。
2. 部署 [relay/](./relay) 里的中转层到 Deno Deploy，把它的域名填进 `VITE_OAUTH_RELAY_URL`，并在中转层里配置 `GITHUB_CLIENT_SECRET`。步骤见 [relay/README.md](./relay/README.md)。

为什么必须有中转层：GitHub 的 `login/oauth/access_token` 端点**不返回任何 CORS 响应头**（官方明确不支持预检请求），而且**必须**携带 `client_secret`——PKCE 只能加强安全性，不能替代 secret。纯静态站点放不下 secret，也不能直接调那个端点，所以「授权码换令牌」这一步由几十行的中转层代劳；`client_secret` 只存在于中转层，前端产物里没有任何密钥。

**B. 个人访问令牌（PAT）—— 兜底方案，0 配置**

到 [github.com/settings/tokens](https://github.com/settings/tokens) 生成 **Fine-grained token**，仓库选本站仓库，权限给 `Contents: Read and write`（经典令牌则勾 `public_repo`，私有仓库勾 `repo`）。粘贴即可登录。只要 `api.github.com` 可达，这条路 100% 可用，因此中转层挂掉或没配置时也不会被锁在门外。

登录结果保存在 `localStorage`（键名 `hdssibal:token`），之后只在浏览器里调用 `api.github.com`。中转层只在登录那一瞬间经手一次授权码，既不落库也拿不到令牌——它回给浏览器的令牌最终仍由你自己保存。

> 早期版本实现过设备码（Device Flow），但实测它要调用的 `github.com/login/*` 端点同样不带 CORS 头，在浏览器里必然失败，因此已整体移除。

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
- **一键登录依赖中转层**：`relay/` 那份代码没部署、没配好 secret，或临时不可用的时候，一键登录会失败；此时弹窗会自动打开并说明原因，改用 PAT 即可。

## 升级路径

1. **把中转层换成你自己的域名**：`relay/src/relay.ts` 与 Cloudflare Workers 同构（`relay/wrangler.toml` 已备好），想换平台或加上自定义域名时直接搬代码即可。
2. **提交走 PR**：把参赛者的写操作改成「fork → 提 PR」，配合分支保护与 `CODEOWNERS`，可以真正强制「只能改自己的作品」，并给管理员一个 review 关卡。
3. **换掉 import.meta.glob**：数据量变大（>几千件作品）时，改成构建期生成索引（或分页 JSON），避免首屏 bundle 过大。
4. **Git LFS / 外部图床**：封面增长到影响仓库大小时，把图片转移到 LFS 或对象存储，`cover` 字段已支持外部 URL。
5. **用 GitHub App 取代 OAuth App**：需要更细的权限粒度（按仓库授权）时可切换，中转层只需改换令牌与校验身份两处。

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