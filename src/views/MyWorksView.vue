<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import EmptyState from '@/components/EmptyState.vue'
import ModalDialog from '@/components/ModalDialog.vue'
import WorkForm from '@/components/WorkForm.vue'
import { assetUrl } from '@/config'
import { useLoginDialog } from '@/composables/useLoginDialog'
import { useToast } from '@/composables/useToast'
import { deleteWork, fetchWorksByAuthor } from '@/services/works'
import { useAuthStore } from '@/stores/auth'
import { useCatalogStore } from '@/stores/catalog'
import type { Work } from '@/types'
import { formatDateTime } from '@/utils/format'
import { safeHref } from '@/utils/url'

const auth = useAuthStore()
const catalog = useCatalogStore()
const toast = useToast()
const router = useRouter()
const { openLogin } = useLoginDialog()

const liveWorks = ref<Work[] | null>(null)
const loading = ref(false)
const editing = ref<Work | null>(null)
const deleteTarget = ref<Work | null>(null)
const deleting = ref(false)
const loadError = ref<string | null>(null)

/** 构建产物里的数据 + 直接从仓库读到的数据，保证刚提交的作品立刻出现。 */
const myWorks = computed<Work[]>(() => {
  const login = auth.login?.toLowerCase()
  if (!login) return []
  const fromBuild = catalog.works.filter((work) => work.author.login.toLowerCase() === login)
  if (!liveWorks.value) return fromBuild
  const merged = new Map(fromBuild.map((work) => [work.id, work]))
  for (const work of liveWorks.value) merged.set(work.id, work)
  return [...merged.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
})

async function refresh(): Promise<void> {
  if (!auth.token || !auth.login) return
  loading.value = true
  loadError.value = null
  try {
    const works = await fetchWorksByAuthor(auth.token, auth.login)
    liveWorks.value = works
    catalog.mergeLiveWorks(works)
  } catch (caught) {
    loadError.value = caught instanceof Error ? caught.message : '读取作品失败。'
  } finally {
    loading.value = false
  }
}

onMounted(refresh)

function onSaved(work: Work): void {
  const list = liveWorks.value ? [...liveWorks.value] : []
  const index = list.findIndex((item) => item.id === work.id)
  if (index >= 0) list[index] = work
  else list.unshift(work)
  liveWorks.value = list
  catalog.mergeLiveWorks([work])
  editing.value = null
}

function startSubmit(): void {
  void router.push({ name: 'submit' })
}

async function confirmDelete(): Promise<void> {
  if (!deleteTarget.value || !auth.token) return
  deleting.value = true
  try {
    await deleteWork(deleteTarget.value, auth.token)
    liveWorks.value = (liveWorks.value ?? []).filter((work) => work.id !== deleteTarget.value!.id)
    toast.success('作品已删除。')
    deleteTarget.value = null
  } catch (caught) {
    toast.error(caught instanceof Error ? caught.message : '删除失败。')
  } finally {
    deleting.value = false
  }
}

function thumb(work: Work): string {
  return assetUrl(work.cover)
}
</script>

<template>
  <div class="container">
    <section class="hero">
      <h1>我的作品</h1>
      <p>在这里提交新作品、修改或删除自己的作品。修改会直接提交到仓库，全站会在重新构建后更新。</p>
    </section>

    <EmptyState
      v-if="!auth.isLoggedIn"
      title="请先登录"
      description="使用 GitHub 账户登录后即可提交与管理你的作品。"
    >
      <button class="btn btn--primary" type="button" @click="openLogin()">登录</button>
    </EmptyState>

    <template v-else>
      <div v-if="auth.isLoggedIn && !auth.canWrite" class="alert alert--warning">
        当前账户对仓库
        <code>{{ auth.identity?.login }}</code> 没有写入权限。请联系管理员把你的账户加为该仓库的协作者，否则提交会被拒绝。
      </div>

      <div v-if="loadError" class="alert alert--danger">{{ loadError }}</div>

      <div class="row" style="margin-bottom: 20px">
        <button class="btn btn--primary" type="button" @click="startSubmit">+ 提交新作品</button>
        <button class="btn" type="button" :disabled="loading" @click="refresh">
          <span v-if="loading" class="spinner"></span>
          刷新
        </button>
        <span class="spacer"></span>
        <span class="small dim">共 {{ myWorks.length }} 件</span>
      </div>

      <EmptyState v-if="!myWorks.length" title="你还没有作品" description="点击「提交新作品」开始你的第一次投稿。">
        <button class="btn btn--primary btn--sm" type="button" @click="startSubmit">提交新作品</button>
      </EmptyState>

      <div v-else class="stack">
        <div v-for="work in myWorks" :key="work.id" class="card row" style="align-items: flex-start; gap: 16px">
          <img
            v-if="thumb(work)"
            :src="thumb(work)"
            :alt="`${work.title} 封面`"
            style="width: 108px; aspect-ratio: 4 / 3; object-fit: cover; border-radius: 8px"
          />
          <div v-else class="work-card__cover--placeholder" style="width: 108px; aspect-ratio: 4 / 3">
            {{ work.title.charAt(0) }}
          </div>

          <div style="flex: 1; min-width: 0">
            <h3 style="margin: 0 0 4px">
              <router-link :to="`/works/${work.id}`">{{ work.title }}</router-link>
            </h3>
            <p class="small muted" style="margin: 0 0 6px">{{ work.summary || '（没有一句话简介）' }}</p>
            <p class="small dim" style="margin: 0">
              活动：{{ catalog.eventTitle(work.eventId) }} · 更新时间 {{ formatDateTime(work.updatedAt) }}
            </p>
            <p v-if="work.chart?.url" class="small dim" style="margin: 0; word-break: break-all">
              谱面链接：<a :href="safeHref(work.chart.url)" target="_blank" rel="noopener noreferrer">{{ work.chart.url }}</a>
            </p>
          </div>

          <div class="row">
            <button class="btn btn--sm" type="button" @click="editing = work">修改</button>
            <button class="btn btn--sm btn--danger" type="button" @click="deleteTarget = work">删除</button>
          </div>
        </div>
      </div>
    </template>
  </div>

  <ModalDialog v-if="editing" title="修改作品" wide @close="editing = null">
    <WorkForm :work="editing" @saved="onSaved" @cancel="editing = null" />
  </ModalDialog>

  <ConfirmDialog
    v-if="deleteTarget"
    title="删除作品"
    danger
    confirm-label="确认删除"
    :busy="deleting"
    :message="`将删除《${deleteTarget.title}》及其封面文件。此操作会直接提交到仓库，无法在页面内撤销。`"
    @confirm="confirmDelete"
    @cancel="deleteTarget = null"
  />
</template>
