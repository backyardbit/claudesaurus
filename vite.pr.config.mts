import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/** The pull request viewer's page, built apart from the chat so its Tailwind stays its own. */
export default defineConfig({
  root: "src/pr",
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "~": fileURLToPath(new URL("./src/pr", import.meta.url)) } },
  worker: { format: "es" },
  build: {
    outDir: "../../dist/pr",
    emptyOutDir: true,
    chunkSizeWarningLimit: 8000,
  },
});
