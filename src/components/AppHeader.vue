<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { repoWebUrl } from '@/config'
import { useLoginDialog } from '@/composables/useLoginDialog'
import { useAuthStore } from '@/stores/auth'
import { useCatalogStore } from '@/stores/catalog'
import { avatarOf } from '@/utils/identity'

const router = useRouter()
const auth = useAuthStore()
const catalog = useCatalogStore()
const { openLogin } = useLoginDialog()

const menuOpen = ref(false)
const menuRoot = ref<HTMLElement | null>(null)

const siteName = computed(() => catalog.config.site.name)
const avatar = computed(() => avatarOf(auth.identity, 64))
const isAdmin = computed(() => auth.isAdmin)

function onDocumentClick(event: MouseEvent): void {
  if (menuRoot.value && !menuRoot.value.contains(event.target as Node)) menuOpen.value = false
}

onMounted(() => document.addEventListener('click', onDocumentClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocumentClick))

function logout(): void {
  auth.logout()
  menuOpen.value = false
  const current = router.currentRoute.value.name
  if (current === 'my-works' || current === 'admin') void router.push('/')
}
</script>

<template>
  <header class="site-header">
    <div class="container site-header__inner">
      <router-link to="/" class="brand">
        <span class="brand__mark">★</span>
        <span>{{ siteName }}</span>
      </router-link>

      <nav class="nav">
        <router-link to="/">首页</router-link>
        <router-link to="/events">活动</router-link>
        <router-link to="/submit">投稿</router-link>
        <router-link to="/me">我的作品</router-link>
        <router-link v-if="isAdmin" to="/admin">管理</router-link>
        <router-link to="/guide">参与指南</router-link>
      </nav>

      <div v-if="auth.isLoggedIn" ref="menuRoot" class="user-menu">
        <button class="user-chip" type="button" @click="menuOpen = !menuOpen">
          <img :src="avatar" :alt="auth.login ?? ''" />
          <span>{{ auth.login }}</span>
          <span v-if="isAdmin" class="badge badge--open">管理员</span>
        </button>
        <div v-if="menuOpen" class="user-menu__panel">
          <router-link to="/me" @click="menuOpen = false">我的作品</router-link>
          <router-link v-if="isAdmin" to="/admin" @click="menuOpen = false">管理后台</router-link>
          <a :href="repoWebUrl" target="_blank" rel="noopener">仓库首页</a>
          <button type="button" @click="logout">退出登录</button>
        </div>
      </div>

      <button v-else class="btn btn--primary" type="button" @click="openLogin()">
        <span aria-hidden="true">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path
              d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.4 7.4 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"
            />
          </svg>
        </span>
        登录
      </button>
    </div>
  </header>
</template>
