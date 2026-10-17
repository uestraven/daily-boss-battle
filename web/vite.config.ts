import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  build: {outDir: '../web-dist', emptyOutDir: true, target: 'es2022'},
  server: {host: '127.0.0.1', port: 5173, strictPort: false, fs: {allow: [fileURLToPath(new URL('..', import.meta.url))]}},
});
