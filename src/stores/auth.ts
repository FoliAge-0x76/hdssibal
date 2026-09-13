import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { oauthEnabled, oauthRedirectUri, oauthRelayUrl } from '@/config'
import {
  AuthError,
  buildAuthorizeUrl,
  describeMissingScope,
  exchangeCodeForToken,
} from '@/services/auth'
import { loadConfig } from '@/services/catalog'
import { GitHubError, fetchIdentity, fetchRepoAccess, type RepoAccess } from '@/services/github'
import { createCodeChallenge, createCodeVerifier, createState } from '@/utils/pkce'
import { useToast } from '@/composables/useToast'
import type { Identity } from '@/types'

const TOKEN_STORAGE_KEY = 'hdssibal:token'
const IDENTITY_STORAGE_KEY = 'hdssibal:identity'
/** 跳转授权页前把 state/verifier 存进 sessionStorage，回跳时用它校验并完成换取。 */
const OAUTH_PENDING_KEY = 'hdssibal:oauth:pending'

export type AuthStatus = 'idle' | 'checking' | 'authenticating' | 'ready'

interface PendingOAuth {
  state: string
  verifier: string
  redirectUri: string
}

function readCachedIdentity(): Identity | null {
  try {
    const raw = localStorage.getItem(IDENTITY_STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Identity) : null
  } catch {
    return null
  }
}

function writeCachedIdentity(identity: Identity | null): void {
  if (identity) localStorage.setItem(IDENTITY_STORAGE_KEY, JSON.stringify(identity))
  else localStorage.removeItem(IDENTITY_STORAGE_KEY)
}

function readPendingOAuth(): PendingOAuth | null {
  try {
    const raw = sessionStorage.getItem(OAUTH_PENDING_KEY)
    return raw ? (JSON.parse(raw) as PendingOAuth) : null
  } catch {
    return null
  }
}

export function describeAuthError(error: unknown): string {
  if (error instanceof GitHubError || error instanceof AuthError) return error.message
  if (error instanceof Error) return error.message
  return '登录失败，请稍后重试。'
}

export const useAuthStore = defineStore('auth', () => {
  const config = loadConfig()
  const toast = useToast()

  const token = ref<string | null>(localStorage.getItem(TOKEN_STORAGE_KEY))
  const identity = ref<Identity | null>(readCachedIdentity())
  const repoAccess = ref<RepoAccess | null>(null)
  const status = ref<AuthStatus>(token.value ? 'checking' : 'idle')
  const error = ref<string | null>(null)

  const isLoggedIn = computed(() => Boolean(token.value && identity.value))
  const login = computed(() => identity.value?.login ?? null)
  const canWrite = computed(() => repoAccess.value?.push === true)
  const isAdmin = computed(() => {
    if (!identity.value) return false
    if (repoAccess.value?.admin) return true
    return config.admins.some((admin) => admin.toLowerCase() === identity.value!.login.toLowerCase())
  })
  const oauthAvailable = computed(() => oauthEnabled)

  function persist(rawToken: string | null, me: Identity | null): void {
    token.value = rawToken
    identity.value = me
    if (rawToken) localStorage.setItem(TOKEN_STORAGE_KEY, rawToken)
    else localStorage.removeItem(TOKEN_STORAGE_KEY)
    writeCachedIdentity(me)
  }

  async function refreshAccess(): Promise<void> {
    if (!token.value) {
      repoAccess.value = null
      return
    }
    try {
      repoAccess.value = await fetchRepoAccess(token.value)
    } catch (caught) {
      // 私有仓库且无权限时会 404，此时只保留最基本的可用状态
      repoAccess.value = null
      if (caught instanceof GitHubError && caught.status !== 404) throw caught
    }
  }

  /** 用访问令牌登录。一键登录与手动 PAT 最终都走这里。 */
  async function loginWithToken(rawToken: string, grantedScopes: string | null = null): Promise<boolean> {
    const candidate = rawToken.trim()
    if (!candidate) {
      error.value = '请粘贴访问令牌。'
      return false
    }
    status.value = 'checking'
    error.value = null
    try {
      const me = await fetchIdentity(candidate)
      persist(candidate, me)
      await refreshAccess()
      status.value = 'ready'
      const scopeIssue = describeMissingScope(grantedScopes)
      if (scopeIssue) toast.error(scopeIssue)
      return true
    } catch (caught) {
      persist(null, null)
      repoAccess.value = null
      status.value = 'idle'
      error.value = describeAuthError(caught)
      return false
    }
  }

  /** 一键登录：生成 state 与 PKCE 参数后跳转到 GitHub 授权页。 */
  async function beginOAuthLogin(): Promise<void> {
    error.value = null
    if (!oauthAvailable.value) {
      error.value = '本站尚未配置 GitHub 一键登录，请使用访问令牌登录。'
      return
    }
    try {
      const verifier = createCodeVerifier()
      const state = createState()
      const redirectUri = oauthRedirectUri()
      const authorizeUrl = buildAuthorizeUrl({
        redirectUri,
        state,
        codeChallenge: await createCodeChallenge(verifier),
      })
      // 用 sessionStorage 而非 localStorage：关掉标签页就作废，减少残留
      sessionStorage.setItem(OAUTH_PENDING_KEY, JSON.stringify({ state, verifier, redirectUri }))
      location.assign(authorizeUrl)
    } catch (caught) {
      error.value = describeAuthError(caught)
    }
  }

  /**
   * 处理从 GitHub 回跳的授权码。命中并成功换取令牌时返回 true。
   * 无论成败都会把 query 从地址栏清掉，避免刷新页面时重放已失效的授权码。
   */
  async function handleOAuthCallback(): Promise<boolean> {
    const params = new URLSearchParams(location.search)
    const code = params.get('code')
    const returnedState = params.get('state')
    const oauthError = params.get('error')
    if (!code && !oauthError) return false

    const pending = readPendingOAuth()
    sessionStorage.removeItem(OAUTH_PENDING_KEY)
    clearOAuthQuery()

    if (oauthError) {
      error.value =
        oauthError === 'access_denied'
          ? '已取消 GitHub 授权。'
          : params.get('error_description') || 'GitHub 授权失败，请重试。'
      status.value = 'idle'
      return false
    }

    if (!pending || !returnedState || returnedState !== pending.state) {
      error.value = '登录校验失败（state 不匹配），请重新登录。'
      status.value = 'idle'
      return false
    }

    status.value = 'authenticating'
    try {
      const result = await exchangeCodeForToken({
        relayUrl: oauthRelayUrl,
        code: code!,
        codeVerifier: pending.verifier,
        redirectUri: pending.redirectUri,
      })
      return await loginWithToken(result.token, result.scopes)
    } catch (caught) {
      status.value = 'idle'
      error.value = describeAuthError(caught)
      return false
    }
  }

  /** 去掉地址栏里的 code/state，保留 hash 路由。 */
  function clearOAuthQuery(): void {
    const url = `${location.origin}${location.pathname}${location.hash}`
    history.replaceState(null, '', url)
  }

  function logout(): void {
    persist(null, null)
    repoAccess.value = null
    error.value = null
    sessionStorage.removeItem(OAUTH_PENDING_KEY)
    status.value = 'idle'
  }

  /** 页面加载时用本地保存的令牌恢复会话；令牌失效则自动登出。 */
  async function restore(): Promise<void> {
    const stored = localStorage.getItem(TOKEN_STORAGE_KEY)
    if (!stored) {
      status.value = 'idle'
      return
    }
    token.value = stored
    identity.value = readCachedIdentity()
    status.value = identity.value ? 'ready' : 'checking'
    try {
      const me = await fetchIdentity(stored)
      identity.value = me
      writeCachedIdentity(me)
      await refreshAccess()
      status.value = 'ready'
    } catch (caught) {
      if (caught instanceof GitHubError && caught.status === 401) {
        logout()
      } else if (!identity.value) {
        logout()
      }
    }
  }

  /** 应用启动入口：优先处理 OAuth 回跳，其次恢复既有会话。 */
  async function bootstrap(): Promise<void> {
    if (await handleOAuthCallback()) return
    await restore()
  }

  return {
    token,
    identity,
    repoAccess,
    status,
    error,
    isLoggedIn,
    login,
    canWrite,
    isAdmin,
    oauthAvailable,
    loginWithToken,
    beginOAuthLogin,
    handleOAuthCallback,
    logout,
    restore,
    bootstrap,
    refreshAccess,
    describeAuthError,
  }
})
