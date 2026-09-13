<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import EmptyState from '@/components/EmptyState.vue'
import ModalDialog from '@/components/ModalDialog.vue'
import WorkForm from '@/components/WorkForm.vue'
import { assetUrl } from '@/config'
import { useToast } from '@/composables/useToast'
import { renderMarkdown } from '@/services/markdown'
import { deleteWork } from '@/services/works'
import { useAuthStore } from '@/stores/auth'
import { useCatalogStore } from '@/stores/catalog'
import { avatarOf } from '@/utils/identity'
import { formatDateTime } from '@/utils/format'

const props = defineProps<{ id: string }>()

const router = useRouter()
const auth = useAuthStore()
const catalog = useCatalogStore()
const toast = useToast()

const editing = ref(false)
const confirmingDelete = ref(false)
const deleting = ref(false)

const work = computed(() => catalog.workById(props.id))
const cover = computed(() => assetUrl(work.value?.cover))
const description = computed(() => renderMarkdown(work.value?.description))
const avatar = computed(() => avatarOf(work.value?.author, 80))

const isOwner = computed(
  () => Boolean(work.value && auth.login && work.value.author.login.toLowerCase() === auth.login!.toLowerCase()),
)
const canManage = computed(() => isOwner.value || auth.isAdmin)
const canEdit = computed(() => isOwner.value || auth.isAdmin)

async function confirmDelete(): Promise<void> {
  if (!work.value || !auth.token) return
  deleting.value = true
  try {
    await deleteWork(work.value, auth.token)
    toast.success('作品已删除，重新构建后对所有人消失。')
    confirmingDelete.value = false
    void router.push('/')
  } catch (caught) {
    toast.error(caught instanceof Error ? caught.message : '删除失败。')
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <div class="container">
    <EmptyState v-if="!work" title="作品不存在" description="它可能已被删除，或者链接有误。">
      <router-link class="btn btn--sm" to="/">返回首页</router-link>
    </EmptyState>

    <template v-else>
      <div class="row small dim" style="margin-bottom: 14px">
        <router-link :to="`/events/${work.eventId}`">← {{ catalog.eventTitle(work.eventId) }}</router-link>
      </div>

      <div class="two-col">
        <div>
          <h1>{{ work.title }}</h1>
          <p v-if="work.summary" class="muted">{{ work.summary }}</p>

          <div class="row" style="margin: 14px 0 22px">
            <img v-if="avatar" :src="avatar" alt="" style="width: 32px; height: 32px; border-radius: 50%" />
            <a :href="`https://github.com/${work.author.login}`" target="_blank" rel="noopener">
              {{ work.author.name ?? work.author.login }}
            </a>
            <span class="dim small">· {{ work.author.login }}</span>
            <span class="spacer"></span>
            <button v-if="canEdit" class="btn btn--sm" type="button" @click="editing = true">编辑</button>
            <button v-if="canManage" class="btn btn--sm btn--danger" type="button" @click="confirmingDelete = true">
              删除
            </button>
          </div>

          <img v-if="cover" :src="cover" :alt="`${work.title} 封面`" class="cover-preview" style="margin-bottom: 24px" />

          <div v-if="work.description" class="card markdown" v-html="description"></div>
          <p v-else class="dim">这件作品还没有填写详细介绍。</p>
        </div>

        <aside class="card">
          <h3 style="font-size: 15px">作品信息</h3>
          <p class="small muted" style="margin: 0 0 10px">
            提交于 {{ formatDateTime(work.createdAt) }}
            <template v-if="work.updatedAt !== work.createdAt">
              <br />更新于 {{ formatDateTime(work.updatedAt) }}
            </template>
          </p>

          <div v-if="work.tags?.length" class="row" style="margin-bottom: 12px">
            <span v-for="tag in work.tags" :key="tag" class="tag">{{ tag }}</span>
          </div>

          <div v-if="work.links?.length" class="stack">
            <a
              v-for="link in work.links"
              :key="link.url"
              class="btn btn--sm"
              :href="link.url"
              target="_blank"
              rel="noopener noreferrer"
            >
              {{ link.label || link.url }}
            </a>
          </div>

          <p class="small dim" style="margin: 14px 0 0">
            作品 ID：<code>{{ work.id }}</code>
          </p>
        </aside>
      </div>
    </template>
  </div>

  <ModalDialog v-if="editing && work" title="修改作品" wide @close="editing = false">
    <WorkForm :work="work" @saved="editing = false" @cancel="editing = false" />
  </ModalDialog>

  <ConfirmDialog
    v-if="confirmingDelete && work"
    title="删除作品"
    danger
    confirm-label="确认删除"
    :busy="deleting"
    :message="`将删除《${work.title}》及其封面文件。此操作会直接提交到仓库，无法在页面内撤销。`"
    @confirm="confirmDelete"
    @cancel="confirmingDelete = false"
  />
</template>
