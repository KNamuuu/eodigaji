import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import planHandler from "./api/plan.js";

// 로컬에서도 /api/plan을 Vercel 함수와 같은 핸들러로
const api = { name: "api", configureServer(s) { s.middlewares.use("/api/plan", planHandler); }, configurePreviewServer(s) { s.middlewares.use("/api/plan", planHandler); } };

// 라이브러리(react·router·supabase)는 따로 묶는다 → 배포해도 앱 코드 조각만 바뀌어 재방문 때 vendor는 캐시(1년, vercel.json)에서
export default defineConfig({
  plugins: [react(), api], server: { port: 3000 }, preview: { port: 3000 },
  build: { chunkSizeWarningLimit: 600, rolldownOptions: { output: { codeSplitting: { groups: [{ name: "vendor", test: /node_modules/ }] } } } },
});
