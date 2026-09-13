<script setup lang="ts">
import { computed } from 'vue'
import AppHeader from '@/components/AppHeader.vue'
import LoginDialog from '@/components/LoginDialog.vue'
import ToastHost from '@/components/ToastHost.vue'
import { useLoginDialog } from '@/composables/useLoginDialog'
import { useAuthStore } from '@/stores/auth'
import { isRepoConfigured, repoRef } from '@/config'

const auth = useAuthStore()
const { loginDialogOpen } = useLoginDialog()

const showConfigWarning = computed(() => !isRepoConfigured)
</script>

<template>
  <AppHeader />

  <main class="page">
    <div v-if="showConfigWarning" class="alert alert--warning container">
      <strong>尚未配置仓库坐标。</strong>
      请在项目根目录创建 <code>.env.local</code>，写入
      <code>VITE_GITHUB_OWNER</code> 与 <code>VITE_GITHUB_REPO</code>；
      部署到 GitHub Pages 后会自动从域名推断，无需配置。
    </div>

    <router-view />
  </main>

  <footer class="site-footer">
    <div class="container site-footer__inner">
      <span>© {{ new Date().getFullYear() }} {{ repoRef.owner }}</span>
      <span class="site-footer__meta">
        静态托管于 GitHub Pages · 数据来自
        <a :href="`https://github.com/${repoRef.owner}/${repoRef.repo}`" target="_blank" rel="noopener">
          {{ repoRef.owner }}/{{ repoRef.repo }}
        </a>
      </span>
    </div>
  </footer>

  <LoginDialog v-model:open="loginDialogOpen" />
  <ToastHost />

  <!-- 让模板里能用上，避免未使用告警 -->
  <span v-if="auth.status === 'checking'" class="visually-hidden">正在校验登录状态…</span>
</template>
