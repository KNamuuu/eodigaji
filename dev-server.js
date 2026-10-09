import http from "node:http";
import fs from "node:fs";
import planHandler, { hasKey } from "./api/plan.js";

const PORT = process.env.PORT || 3000;
http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/api/plan") return planHandler(req, res);
  const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  if (!/^[\w-]+\.(html|json)$/.test(file) || !fs.existsSync("public/" + file)) return res.writeHead(404).end();
  res.writeHead(200, { "content-type": file.endsWith(".json") ? "application/json" : "text/html; charset=utf-8" });
  fs.createReadStream("public/" + file).pipe(res);
}).listen(PORT, () => console.log(`http://localhost:${PORT} (AI ${hasKey ? "on" : "off: 샘플 일정"})`));
