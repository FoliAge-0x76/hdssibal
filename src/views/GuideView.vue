<script setup lang="ts">
import { computed } from 'vue'
import { repoRef, repoWebUrl } from '@/config'
import { useLoginDialog } from '@/composables/useLoginDialog'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const { openLogin } = useLoginDialog()

const repoLabel = computed(() => `${repoRef.owner}/${repoRef.repo}`)
</script>

<template>
  <div class="container">
    <section class="hero">
      <h1>参与指南</h1>
      <p>本站是一个纯静态的 GitHub Pages 站点，所有的活动与作品数据都存放在公开仓库里，任何人都可以查看与审计。</p>
    </section>

    <section class="section">
      <h2>参赛者</h2>
      <div class="stack">
        <div class="card">
          <h3>1. 用 GitHub 账户登录</h3>
          <p class="muted small" style="margin: 0">
            点击右上角「登录」。可以使用设备码登录，也可以粘贴个人访问令牌。令牌只保存在你自己的浏览器
            localStorage 中，不会发送到除 <code>api.github.com</code> 以外的任何服务器。
          </p>
          <div class="row" style="margin-top: 12px">
            <button v-if="!auth.isLoggedIn" class="btn btn--primary btn--sm" type="button" @click="openLogin()">
              立即登录
            </button>
            <span v-else class="small dim">当前已登录为 {{ auth.login }}</span>
          </div>
        </div>

        <div class="card">
          <h3>2. 确认仓库写入权限</h3>
          <p class="muted small" style="margin: 0">
            作品会以你的名义直接提交到仓库
            <a :href="repoWebUrl" target="_blank" rel="noopener"><code>{{ repoLabel }}</code></a>。因此你的账户需要是该仓库的协作者（Write 权限）：
            请把 GitHub 用户名发给管理员，由管理员在仓库的 <em>Settings → Collaborators</em> 中邀请你。
          </p>
          <p v-if="auth.isLoggedIn && auth.accessChecked && !auth.canWrite" class="small" style="margin: 10px 0 0; color: var(--warning)">
            检测到当前账户尚无写入权限，提交作品时会被 GitHub 拒绝。
          </p>
        </div>

        <div class="card">
          <h3>3. 提交作品</h3>
          <p class="muted small" style="margin: 0 0 8px">
            打开 <router-link to="/submit">投稿页</router-link>，或从活动页点「投稿至此活动」进入。三样东西缺一不可：
          </p>
          <ul class="muted small" style="margin: 0 0 8px; padding-left: 20px">
            <li><strong>一个正在进行的活动</strong>：只能勾选已开始且未截止的活动，未开始、已截止的活动不会出现在列表里。</li>
            <li><strong>一张封面图</strong>：文件名不限，PNG / JPEG / WebP / GIF 均可，会自动压缩到最长边 1600px，避免仓库体积膨胀。</li>
            <li><strong>一个谱面下载链接</strong>：http/https 地址，网盘分享、直链或 GitHub Release 都可以。</li>
          </ul>
          <p class="muted small" style="margin: 0">
            表单底部的「投稿条件」会实时显示还缺哪一项，全部满足后「提交作品」按钮才会亮起。提交后可以随时回到
            <router-link to="/me">我的作品</router-link>修改或删除自己的作品。
          </p>
        </div>

        <div class="card">
          <h3>4. 等待全站可见</h3>
          <p class="muted small" style="margin: 0">
            提交的内容会立刻写进仓库，但所有人看到的列表来自站点的构建产物，因此需要等 GitHub Actions
            重新构建（通常 1 分钟以内）后才会出现在首页、活动页和最近活动里。你自己的「我的作品」页面会直接读取仓库，无需等待。
          </p>
        </div>
      </div>
    </section>

    <section class="section">
      <h2>管理员</h2>
      <div class="stack">
        <div class="card">
          <h3>权限来源</h3>
          <p class="muted small" style="margin: 0">
            拥有仓库 <strong>Admin</strong> 权限的账户自动成为管理员；此外 <code>data/config.json</code> 里的
            <code>admins</code> 数组可以额外授权（便于把活动运营交给不持有仓库管理权限的人）。
          </p>
        </div>
        <div class="card">
          <h3>可以做什么</h3>
          <p class="muted small" style="margin: 0">
            管理后台支持新建/编辑/删除活动，以及删除任意作品。删除活动时如果该活动下还有作品，会先要求二次确认。
          </p>
        </div>
      </div>
    </section>

    <section class="section">
      <h2>常见问题</h2>
      <div class="stack">
        <div class="card">
          <h3>为什么我的作品会在仓库里留下一次提交记录？</h3>
          <p class="muted small" style="margin: 0">
            这就是「仓库即数据库」的设计：作品数据是 <code>data/works/*.json</code>，封面是
            <code>public/works/*</code>，每次投稿都是一次 Git 提交，天然具备版本历史与回滚能力。
          </p>
        </div>
        <div class="card">
          <h3>谱面文件放在哪里？</h3>
          <p class="muted small" style="margin: 0">
            谱面本身不进仓库，站点只保存你填写的下载链接（写在作品的 <code>chart.url</code> 字段里）。
            这样可以避开仓库大小限制，也方便你随时更新谱面文件而不用重新投稿；链接失效时记得回来更新，否则观众点开会看到失效页面。
          </p>
        </div>
        <div class="card">
          <h3>能修改别人的作品吗？</h3>
          <p class="muted small" style="margin: 0">
            页面只会给作品的作者和管理员显示编辑/删除按钮，但协作者在 Git 层面理论上可以修改任何文件。
            要做到强隔离，需要改为「参赛者提 PR + 分支保护」或引入独立后端。
          </p>
        </div>
        <div class="card">
          <h3>令牌权限怎么选？</h3>
          <p class="muted small" style="margin: 0">
            Classic 令牌勾选 <code>public_repo</code> 即可；Fine-grained 令牌把
            <em>Contents</em> 设为 <em>Read and write</em> 并只授权本仓库，最小化风险。用完可以在 GitHub 设置里随时吊销。
          </p>
        </div>
      </div>
    </section>
  </div>
</template>
