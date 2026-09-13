<script setup lang="ts">
import { ref, watch } from 'vue'
import ModalDialog from './ModalDialog.vue'
import { oauthScopes, repoRef } from '@/config'
import { useToast } from '@/composables/useToast'
import { describeAuthError, useAuthStore } from '@/stores/auth'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [boolean] }>()

const auth = useAuthStore()
const toast = useToast()

const mode = ref<'device' | 'token'>('device')
const tokenInput = ref('')
const busy = ref(false)
const message = ref<string | null>(null)
const polling = ref(false)

watch(
  () => props.open,
  (open) => {
    if (!open) {
      if (polling.value) auth.cancelDeviceLogin()
      resetBusy()
    } else {
      message.value = null
      mode.value = auth.deviceAvailable ? 'device' : 'token'
    }
  },
)

function resetBusy(): void {
  busy.value = false
  polling.value = false
}

function close(): void {
  emit('update:open', false)
}

function tokenUrl(): string {
  const scopes = oauthScopes.split(/[,\s]+/).filter(Boolean).join(',')
  const description = encodeURIComponent(`${repoRef.owner}/${repoRef.repo} 比赛会场投稿`)
  return `https://github.com/settings/tokens/new?scopes=${encodeURIComponent(scopes)}&description=${description}`
}

function describeScope(): string {
  const scopes = oauthScopes.split(/[,\s]+/).filter(Boolean)
  if (scopes.includes('public_repo')) return 'public_repo（公开仓库读写）'
  if (scopes.includes('repo')) return 'repo（全部仓库读写）'
  return oauthScopes
}

function messageFromError(error: unknown): string {
  return describeAuthError(error)
}

async function startDeviceLogin(): Promise<void> {
  busy.value = true
  message.value = null
  try {
    await auth.beginDeviceLogin()
    polling.value = true
    const ok = await auth.completeDeviceLogin()
    if (ok) {
      toast.success(`已登录为 ${auth.login}`)
      close()
      return
    }
    if (auth.error) message.value = auth.error
  } catch (error) {
    message.value = messageFromError(error)
  } finally {
    resetBusy()
  }
}

async function submitToken(): Promise<void> {
  busy.value = true
  message.value = null
  try {
    const ok = await auth.loginWithToken(tokenInput.value)
    if (ok) {
      tokenInput.value = ''
      toast.success(`已登录为 ${auth.login}`)
      close()
      return
    }
    message.value = auth.error ?? '登录失败，请检查令牌。'
  } catch (error) {
    message.value = messageFromError(error)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <ModalDialog v-if="props.open" title="登录 / 注册" @close="close">
    <p class="muted small">
      站点使用你的 GitHub 账户作为身份标识，作品会以你的账户名义提交到仓库
      <code>{{ repoRef.owner }}/{{ repoRef.repo }}</code>。密码永远不经过本站，令牌只保存在你自己的浏览器里。
    </p>

    <div class="row" style="margin: 14px 0 18px">
      <button
        class="btn btn--sm"
        :class="{ 'btn--primary': mode === 'device' }"
        type="button"
        :disabled="!auth.deviceAvailable"
        @click="mode = 'device'"
      >
        设备码登录
      </button>
      <button
        class="btn btn--sm"
        :class="{ 'btn--primary': mode === 'token' }"
        type="button"
        @click="mode = 'token'"
      >
        访问令牌登录
      </button>
    </div>

    <div v-if="message" class="alert alert--danger" style="margin-bottom: 14px">{{ message }}</div>

    <template v-if="mode === 'device'">
      <div v-if="!auth.deviceAvailable" class="alert alert--warning">
        尚未配置 OAuth App 的 Client ID（<code>VITE_OAUTH_CLIENT_ID</code>），暂时无法使用设备码登录，请改用访问令牌。
      </div>
      <template v-else>
        <p class="small muted">
          点击下面的按钮后会得到一个 8 位用户码，在 GitHub 页面输入即可完成授权，全程无需在浏览器里粘贴令牌。
        </p>
        <div v-if="auth.device" class="card" style="text-align: center">
          <p class="small dim" style="margin: 0 0 6px">在 GitHub 输入此用户码</p>
          <p class="mono" style="font-size: 26px; letter-spacing: 3px; margin: 0 0 12px">
            {{ auth.device.userCode }}
          </p>
          <a class="btn btn--primary" :href="auth.device.verificationUri" target="_blank" rel="noopener">
            打开 GitHub 授权页
          </a>
          <p v-if="polling" class="row small dim" style="justify-content: center; margin: 14px 0 0">
            <span class="spinner"></span>
            正在等待你在 GitHub 上确认…
          </p>
        </div>
        <div class="modal__actions">
          <button v-if="polling" class="btn" type="button" @click="auth.cancelDeviceLogin()">取消</button>
          <button v-else class="btn btn--primary" type="button" :disabled="busy" @click="startDeviceLogin">
            <span v-if="busy" class="spinner"></span>
            开始设备码登录
          </button>
        </div>
      </template>
    </template>

    <template v-else>
      <div class="field">
        <label for="login-token">个人访问令牌（Personal Access Token）</label>
        <input id="login-token" v-model="tokenInput" type="text" autocomplete="off" placeholder="ghp_… / github_pat_…" />
        <span class="field__hint">
          需要一个具备「{{ describeScope() }}」权限的令牌：
          <a :href="tokenUrl()" target="_blank" rel="noopener">点此创建</a>
          （已预填权限）。Fine-grained 令牌请把
          <em>Contents</em> 设为 <em>Read and write</em>，并选择目标仓库
          <code>{{ repoRef.owner }}/{{ repoRef.repo }}</code>。
        </span>
      </div>
      <div class="modal__actions">
        <button class="btn btn--primary" type="button" :disabled="busy || !tokenInput.trim()" @click="submitToken">
          <span v-if="busy" class="spinner"></span>
          登录
        </button>
      </div>
    </template>
  </ModalDialog>
</template>
