import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  /* Tailwind must run with Vite so utilities are generated; order with React is stable this way. */
  plugins: [tailwindcss(), react()],
  base: './',
  server: {
    port: 5555,
    strictPort: true,
  }
})
