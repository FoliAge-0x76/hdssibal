import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { oauthEnabled, oauthRelayUrl, oauthReturnUrl, oauthScopes } from '@/config'
import {
  AuthError,
  buildRelayAuthorizeUrl,
  describeMissingScope,
  exchangeSessionForToken,
} from '@/services/auth'
import { loadConfig } from '@/services/catalog'
import { GitHubError, fetchIdentity, fetchRepoAccess, type RepoAccess } from '@/services/github'
import { randomToken } from '@/utils/randomToken'
import { openOAuthPopup, waitForOAuthResult, type OAuthResult } from '@/utils/oauthWindow'
import { useToast } from '@/composables/useToast'
import type { Identity } from '@/types'

const TOKEN_STORAGE_KEY = 'hdssibal:token'
const IDENTITY_STORAGE_KEY = 'hdssibal:identity'
/** 跳转授权页前把 nonce 存进 sessionStorage，回跳时用它确认这次登录确实由本站发起。 */
const OAUTH_PENDING_KEY = 'hdssibal:oauth:pending'
/** 整页回落会丢掉 hash 路由，起跳前先记下来，登录成功后还回去。 */
const OAUTH_RETURN_KEY = 'hdssibal:oauth:return'

export type AuthStatus = 'idle' | 'checking' | 'authenticating' | 'ready'

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
  const accessStatus = ref<'idle' | 'loading' | 'ready'>('idle')
  const status = ref<AuthStatus>(token.value ? 'checking' : 'idle')
  const error = ref<string | null>(null)

  const isLoggedIn = computed(() => Boolean(token.value && identity.value))
  const login = computed(() => identity.value?.login ?? null)
  const canWrite = computed(() => repoAccess.value?.push === true)
  /** 仓库权限是否已经问过 GitHub。未问过时 canWrite 为 false，但那不代表「没权限」。 */
  const accessChecked = computed(() => accessStatus.value === 'ready')
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
      accessStatus.value = 'ready'
      return
    }
    accessStatus.value = 'loading'
    try {
      repoAccess.value = await fetchRepoAccess(token.value)
    } catch (caught) {
      // 私有仓库且无权限时会 404，此时只保留最基本的可用状态
      repoAccess.value = null
      if (caught instanceof GitHubError && caught.status !== 404) throw caught
    } finally {
      accessStatus.value = 'ready'
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

  /**
   * 一键登录：把本站的回跳地址交给中转层，然后打开 GitHub 授权页。
   *
   * 优先用弹窗，这样授权期间用户不会丢失当前浏览位置；弹窗被拦截时退化成整页跳转，
   * 回跳后由 bootstrap() 接管。两种路径最终都汇到 completeOAuth()。
   */
  async function beginOAuthLogin(): Promise<void> {
    error.value = null
    if (!oauthAvailable.value) {
      error.value = '本站尚未配置 GitHub 一键登录，请使用访问令牌登录。'
      return
    }
    try {
      // 只存 nonce，不存任何会被中转层重新封装的东西
      const nonce = randomToken()
      sessionStorage.setItem(OAUTH_PENDING_KEY, nonce)
      sessionStorage.setItem(OAUTH_RETURN_KEY, location.hash)
      const authorizeUrl = buildRelayAuthorizeUrl({
        relayUrl: oauthRelayUrl,
        redirectUri: oauthReturnUrl(),
        state: nonce,
        scope: oauthScopes,
      })

      const popup = openOAuthPopup(authorizeUrl)
      status.value = 'authenticating'
      if (!popup) {
        location.assign(authorizeUrl)
        return
      }

      const result = await waitForOAuthResult(popup)
      if (!result) {
        status.value = 'idle'
        error.value = 'GitHub 授权未完成（窗口被关闭或等待超时），请重试或改用访问令牌登录。'
        return
      }
      await completeOAuth(result)
    } catch (caught) {
      status.value = 'idle'
      error.value = describeAuthError(caught)
    }
  }

  /**
   * 用中转层送回的结果完成登录。弹窗消息与整页回跳共用这一条路径。
   */
  async function completeOAuth(result: OAuthResult): Promise<boolean> {
    const pending = sessionStorage.getItem(OAUTH_PENDING_KEY)
    sessionStorage.removeItem(OAUTH_PENDING_KEY)

    if (result.error) {
      status.value = 'idle'
      error.value =
        result.error === 'access_denied'
          ? '已取消 GitHub 授权。'
          : result.errorDescription || 'GitHub 授权失败，请重试。'
      restoreRoute()
      return false
    }

    if (!result.session || !pending || result.state !== pending) {
      status.value = 'idle'
      error.value = '登录校验失败（state 不匹配），请重新登录。'
      restoreRoute()
      return false
    }

    status.value = 'authenticating'
    try {
      const exchanged = await exchangeSessionForToken({
        relayUrl: oauthRelayUrl,
        session: result.session,
      })
      return await loginWithToken(exchanged.token, exchanged.scopes)
    } catch (caught) {
      status.value = 'idle'
      error.value = describeAuthError(caught)
      return false
    } finally {
      restoreRoute()
    }
  }

  /**
   * 处理整页回落留下的查询参数（弹窗路径不会有）。无论成败都会把 query 从地址栏清掉，
   * 避免刷新页面时用同一个凭据再换一次令牌。
   */
  async function handleOAuthCallback(): Promise<boolean> {
    const params = new URLSearchParams(location.search)
    const session = params.get('session')
    const oauthError = params.get('error')
    if (!session && !oauthError) return false

    clearOAuthQuery()
    return await completeOAuth({
      session: session ?? undefined,
      state: params.get('state') ?? undefined,
      error: oauthError ?? undefined,
      errorDescription: params.get('error_description') ?? undefined,
    })
  }

  /** 去掉地址栏里的 session/state，保留 hash 路由。 */
  function clearOAuthQuery(): void {
    const url = `${location.origin}${location.pathname}${location.hash}`
    history.replaceState(null, '', url)
  }

  /**
   * 整页回落时中间经过了 /oauth/callback.html，hash 路由会在那一跳丢掉。
   * 登录结束后把它还原，用户就不会莫名其妙回到首页。
   */
  function restoreRoute(): void {
    const saved = sessionStorage.getItem(OAUTH_RETURN_KEY)
    sessionStorage.removeItem(OAUTH_RETURN_KEY)
    if (!saved || saved === '#/') return
    // 回跳后 Vue Router 会把空 hash 规范成 '#/'，所以停在 '#/' 也算「还没导航」；
    // 只有用户已经跳到别的路由时才不动他的位置。
    if (location.hash && location.hash !== '#/') return
    location.hash = saved
  }

  function logout(): void {
    persist(null, null)
    repoAccess.value = null
    error.value = null
    sessionStorage.removeItem(OAUTH_PENDING_KEY)
    sessionStorage.removeItem(OAUTH_RETURN_KEY)
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
    accessChecked,
    isAdmin,
    oauthAvailable,
    loginWithToken,
    beginOAuthLogin,
    completeOAuth,
    handleOAuthCallback,
    logout,
    restore,
    bootstrap,
    refreshAccess,
    describeAuthError,
  }
})
