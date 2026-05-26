import { defineNuxtConfig } from "nuxt/config";

export default defineNuxtConfig({
  compatibilityDate: "2025-05-15",
  devtools: { enabled: false },
  modules: ["@pinia/nuxt"],
  ssr: false,
  srcDir: "src",
  telemetry: false,
  css: [
    "github-markdown-css/github-markdown.css",
    "katex/dist/katex.min.css",
    "~/styles/app.css",
    "~/styles/markdown.css",
  ],
  vite: {
    clearScreen: false,
    envPrefix: ["VITE_", "TAURI_"],
    optimizeDeps: {
      include: [
        "@lucide/vue",
        "@tauri-apps/api/core",
        "@tauri-apps/api/event",
        "@tauri-apps/api/webview",
        "mermaid",
        "rehype-autolink-headings",
        "rehype-katex",
        "rehype-raw",
        "rehype-sanitize",
        "rehype-slug",
        "rehype-stringify",
        "remark-frontmatter",
        "remark-gfm",
        "remark-math",
        "remark-parse",
        "remark-rehype",
        "unified",
      ],
    },
    server: {
      strictPort: true,
    },
  },
  nitro: {
    output: {
      publicDir: "dist",
    },
  },
  ignore: ["**/src-tauri/**"],
});
