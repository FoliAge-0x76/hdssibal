/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 仓库所有者（用户名或组织名）。部署到 GitHub Pages 时会自动从域名推断，本地开发需填写。 */
  readonly VITE_GITHUB_OWNER?: string
  /** 仓库名。部署到 GitHub Pages 时会自动从路径推断，本地开发需填写。 */
  readonly VITE_GITHUB_REPO?: string
  /** 数据所在分支，默认 main。 */
  readonly VITE_GITHUB_BRANCH?: string
  /** GitHub OAuth App 的 Client ID（设备码登录用，不需要 client secret）。留空则只能使用访问令牌登录。 */
  readonly VITE_OAUTH_CLIENT_ID?: string
  /** 设备码登录申请的权限范围，默认 public_repo。 */
  readonly VITE_OAUTH_SCOPES?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
