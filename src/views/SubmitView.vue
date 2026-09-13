<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import EmptyState from '@/components/EmptyState.vue'
import WorkForm from '@/components/WorkForm.vue'
import { useLoginDialog } from '@/composables/useLoginDialog'
import { useCatalogStore } from '@/stores/catalog'
import { useAuthStore } from '@/stores/auth'
import { isEventOngoing } from '@/utils/eventWindow'
import type { Work } from '@/types'

const auth = useAuthStore()
const catalog = useCatalogStore()
const route = useRoute()
const router = useRouter()
const { openLogin } = useLoginDialog()

/** 从 /submit?event=<id> 带入默认活动；只有进行中的活动才认。 */
const defaultEventId = computed(() => {
  const requested = typeof route.query.event === 'string' ? route.query.event : undefined
  if (requested) {
    const event = catalog.eventById(requested)
    if (event && isEventOngoing(event)) return event.id
  }
  return catalog.defaultEvent?.id
})

const ongoingCount = computed(() => catalog.events.filter((event) => isEventOngoing(event)).length)

function onSaved(work: Work): void {
  void router.push({ name: 'work', params: { id: work.id } })
}

function goBack(): void {
  void router.push({ name: 'home' })
}
</script>

<template>
  <div class="container">
    <section class="hero">
      <h1>投稿作品</h1>
      <p>选择正在进行中的活动，上传一张封面图并填写谱面下载链接，就能把作品提交到会场。</p>
    </section>

    <EmptyState
      v-if="!auth.isLoggedIn"
      title="请先登录再投稿"
      description="投稿会把文件提交到仓库，因此需要 GitHub 账户（或已开通的第三方登录）与仓库写入权限。"
    >
      <button class="btn btn--primary" type="button" @click="openLogin()">立即登录</button>
    </EmptyState>

    <div v-else class="submit-wrap">
      <div v-if="!auth.canWrite" class="alert alert--warning">
        当前账户对仓库没有写入权限，投稿会失败。请联系管理员把你的账号加入协作者，或改用具备写入权限的账户登录。
      </div>
      <div v-if="!ongoingCount" class="alert alert--info">
        现在没有正在进行中的活动，等管理员开启新活动后就能投稿了。
        <router-link to="/events">查看全部活动 →</router-link>
      </div>

      <div class="card submit-card">
        <WorkForm :default-event-id="defaultEventId" @saved="onSaved" @cancel="goBack" />
      </div>
    </div>
  </div>
</template>
