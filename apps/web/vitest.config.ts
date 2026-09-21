import path from "node:path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

export default defineConfig({
  // apps/web's tsconfig sets `jsx: "preserve"` for Next's compiler, so nothing
  // else transforms JSX. Tests need it compiled.
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, ".") },
  },
  test: {
    // Tiptap builds a ProseMirror view, which needs a DOM.
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["lib/**/*.test.{ts,tsx}", "components/**/*.test.tsx"],
  },
})
