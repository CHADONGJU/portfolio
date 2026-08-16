import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // App은 lazy import로 이미 분리된다. 여기서는 거의 바뀌지 않는 의존성을 따로 떼어
    // 앱 코드를 고쳐도 사용자가 그 청크를 다시 받지 않게 한다.
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('firebase') || id.includes('@firebase')) return 'firebase'
          if (id.includes('react-dom') || id.includes('/react/') || id.includes('scheduler')) return 'react'
          if (id.includes('lucide-react')) return 'icons'
          return undefined
        },
      },
    },
  },
})
