import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const devHost = env.VITE_DEV_HOST ?? '0.0.0.0';
  const devPort = Number(env.VITE_DEV_PORT ?? 5173);
  const apiTarget = env.VITE_API_URL ?? 'http://localhost:3000';

  return {
    plugins: [vue()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src')
      }
    },
    server: {
      host: devHost,
      port: devPort,
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true
        }
      }
    }
  };
});
