import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  server: {
    // The SQLite file lives in ./data - writing to it must not trigger page reloads
    watch: { ignored: ["**/data/**"] }
  }
});
