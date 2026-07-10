import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({ plugins: [react()], build: { outDir: "dist/client" }, server: { proxy: { "/ws": { target: "ws://localhost:4317", ws: true } } } });
