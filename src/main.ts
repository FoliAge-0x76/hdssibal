import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import { useAuthStore } from './stores/auth'
import './styles/main.css'

const app = createApp(App)
app.use(createPinia())
app.use(router)

// 启动时优先处理 GitHub 一键登录的回跳（需要抢在路由改写地址栏之前读 query），
// 没命中再用本地保存的令牌恢复会话。
void useAuthStore().bootstrap()

app.mount('#app')
