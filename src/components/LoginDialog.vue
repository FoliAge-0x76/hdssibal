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

const mode = ref<'oauth' | 'token'>('oauth')
const tokenInput = ref('')
const busy = ref(false)
const message = ref<string | null>(null)

watch(
  () => props.open,
  (open) => {
    if (open) {
      mode.value = auth.oauthAvailable ? 'oauth' : 'token'
      // 回跳失败时 store 会在挂载前就写入 error（App 里那个 immediate watcher 会立刻打开本弹窗），
      // 因此这里必须 immediate，否则同步失败的原因不会显示出来。
      message.value = auth.error
      busy.value = false
    } else {
      busy.value = false
    }
  },
  { immediate: true },
)

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

/** 一键登录会整页跳转到 GitHub，成功与否由回跳后的 bootstrap() 判定，这里只处理起跳失败。 */
async function startOAuthLogin(): Promise<void> {
  message.value = null
  busy.value = true
  await auth.beginOAuthLogin()
  if (auth.error) {
    message.value = auth.error
    busy.value = false
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
      <code>{{ repoRef.owner }}/{{ repoRef.repo }}</code>。密码永远不经过本站，授权结果也只保存在你自己的浏览器里。
    </p>

    <div class="row" style="margin: 14px 0 18px">
      <button
        class="btn btn--sm"
        :class="{ 'btn--primary': mode === 'oauth' }"
        type="button"
        @click="mode = 'oauth'"
      >
        GitHub 一键登录
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

    <template v-if="mode === 'oauth'">
      <div v-if="!auth.oauthAvailable" class="alert alert--warning">
        尚未配置 GitHub 一键登录：需要同时提供 OAuth App 的
        <code>VITE_OAUTH_CLIENT_ID</code> 与中转层地址 <code>VITE_OAUTH_RELAY_URL</code>
        （见 <code>docs/SETUP.md</code> 第 5 节）。在此之前请改用访问令牌登录。
      </div>
      <template v-else>
        <p class="small muted">
          点击下面的按钮会跳转到 GitHub 授权页，确认后自动回到本站完成登录，无需手动创建或粘贴令牌。
          本站只会获得「{{ describeScope() }}」范围的权限。
        </p>
        <p class="small dim">
          如果浏览器拦截了跳转，或授权后没有回到本站，请改用访问令牌登录。
        </p>
        <div class="modal__actions">
          <button class="btn btn--primary" type="button" :disabled="busy" @click="startOAuthLogin">
            <span v-if="busy" class="spinner"></span>
            使用 GitHub 登录
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
