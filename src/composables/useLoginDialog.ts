import { ref } from 'vue'

/** 登录弹窗的开关状态需要被多个视图（首页、我的作品、活动页）共同触发，因此做成模块级共享状态。 */
const loginDialogOpen = ref(false)

export function useLoginDialog() {
  return {
    loginDialogOpen,
    openLogin: () => {
      loginDialogOpen.value = true
    },
    closeLogin: () => {
      loginDialogOpen.value = false
    },
  }
}
