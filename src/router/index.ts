import { createRouter, createWebHashHistory } from 'vue-router'

/**
 * 使用 hash 路由：GitHub Pages 是纯静态托管，hash 路由不需要 404.html 兜底，
 * 配合 vite 的相对 base，可以同时适配项目站点、用户主页和自定义域名。
 */
export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'home', component: () => import('@/views/HomeView.vue') },
    { path: '/events', name: 'events', component: () => import('@/views/EventsView.vue') },
    {
      path: '/events/:id',
      name: 'event',
      component: () => import('@/views/EventDetailView.vue'),
      props: true,
    },
    {
      path: '/works/:id',
      name: 'work',
      component: () => import('@/views/WorkDetailView.vue'),
      props: true,
    },
    { path: '/me', name: 'my-works', component: () => import('@/views/MyWorksView.vue') },
    { path: '/admin', name: 'admin', component: () => import('@/views/AdminView.vue') },
    { path: '/guide', name: 'guide', component: () => import('@/views/GuideView.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
  scrollBehavior: (_to, _from, savedPosition) => savedPosition ?? { top: 0 },
})
