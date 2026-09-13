import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { deviceFlowEnabled } from '@/config'
import {
  AuthError,
  pollDeviceFlow,
  startDeviceFlow,
  type DeviceFlowStart,
} from '@/services/auth'
import { loadConfig } from '@/services/catalog'
import { GitHubError, fetchIdentity, fetchRepoAccess, type RepoAccess } from '@/services/github'
import type { Identity } from '@/types'

const TOKEN_STORAGE_KEY = 'hdssibal:token'
const IDENTITY_STORAGE_KEY = 'hdssibal:identity'

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function describeAuthError(error: unknown): string {
  if (error instanceof GitHubError || error instanceof AuthError) return error.message
  if (error instanceof Error) return error.message
  return '登录失败，请稍后重试。'
}

export const useAuthStore = defineStore('auth', () => {
  const config = loadConfig()

  const token = ref<string | null>(localStorage.getItem(TOKEN_STORAGE_KEY))
  const identity = ref<Identity | null>(readCachedIdentity())
  const repoAccess = ref<RepoAccess | null>(null)
  const status = ref<AuthStatus>(token.value ? 'checking' : 'idle')
  const error = ref<string | null>(null)
  const device = ref<DeviceFlowStart | null>(null)

  let cancelPolling = false

  const isLoggedIn = computed(() => Boolean(token.value && identity.value))
  const login = computed(() => identity.value?.login ?? null)
  const canWrite = computed(() => repoAccess.value?.push === true)
  const isAdmin = computed(() => {
    if (!identity.value) return false
    if (repoAccess.value?.admin) return true
    return config.admins.some((admin) => admin.toLowerCase() === identity.value!.login.toLowerCase())
  })
  const deviceAvailable = computed(() => deviceFlowEnabled)

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

  /** 用访问令牌（PAT）登录。 */
  async function loginWithToken(rawToken: string): Promise<boolean> {
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
      return true
    } catch (caught) {
      persist(null, null)
      repoAccess.value = null
      status.value = 'idle'
      error.value = describeAuthError(caught)
      return false
    }
  }

  /** 设备码登录第 1 步：拿到用户码，提示用户去 github.com/login/device 输入。 */
  async function beginDeviceLogin(): Promise<DeviceFlowStart> {
    error.value = null
    cancelPolling = false
    const started = await startDeviceFlow()
    device.value = started
    return started
  }

  /** 设备码登录第 2 步：轮询直到用户完成授权。 */
  async function completeDeviceLogin(): Promise<boolean> {
    const current = device.value
    if (!current) return false
    status.value = 'authenticating'
    let intervalSeconds = Math.max(5, current.interval)
    const deadline = Date.now() + current.expiresIn * 1000

    while (!cancelPolling && Date.now() < deadline && device.value) {
      await sleep(intervalSeconds * 1000)
      if (cancelPolling || !device.value) break
      const result = await pollDeviceFlow(current.deviceCode)
      if (result.status === 'token') {
        device.value = null
        return loginWithToken(result.token)
      }
      if (result.status === 'slow_down') intervalSeconds = result.interval
    }

    device.value = null
    status.value = isLoggedIn.value ? 'ready' : 'idle'
    if (!isLoggedIn.value) error.value = '设备码已过期或登录已取消，请重新开始。'
    return false
  }

  function cancelDeviceLogin(): void {
    cancelPolling = true
    device.value = null
    status.value = isLoggedIn.value ? 'ready' : 'idle'
  }

  function logout(): void {
    cancelPolling = true
    persist(null, null)
    repoAccess.value = null
    device.value = null
    error.value = null
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

  return {
    token,
    identity,
    repoAccess,
    status,
    error,
    device,
    isLoggedIn,
    login,
    canWrite,
    isAdmin,
    deviceAvailable,
    loginWithToken,
    beginDeviceLogin,
    completeDeviceLogin,
    cancelDeviceLogin,
    logout,
    restore,
    refreshAccess,
    describeAuthError,
  }
})
