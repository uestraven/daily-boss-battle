import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  build: {outDir: '../web-dist', emptyOutDir: true, target: 'es2022'},
  // host: true binds all interfaces so a phone on the same network can open the dev
  // server directly. Testing on the real Android target answers the questions that
  // matter -- touch latency, 60fps, safe areas -- without needing a native wrapper.
  server: {host: true, port: 5173, strictPort: false, fs: {allow: [fileURLToPath(new URL('..', import.meta.url))]}},
});
