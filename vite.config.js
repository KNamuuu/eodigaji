import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import planHandler from "./api/plan.js";

// 로컬에서도 /api/plan을 Vercel 함수와 같은 핸들러로
const api = { name: "api", configureServer(s) { s.middlewares.use("/api/plan", planHandler); }, configurePreviewServer(s) { s.middlewares.use("/api/plan", planHandler); } };

export default defineConfig({ plugins: [react(), api], server: { port: 3000 }, preview: { port: 3000 } });
