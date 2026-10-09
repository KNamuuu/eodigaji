// /api/plan?place= — Vercel 함수이자 로컬 server.js가 그대로 쓰는 핸들러
import Anthropic from "@anthropic-ai/sdk";

export const hasKey = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
const client = hasKey ? new Anthropic() : null;

const PLAN_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    days: {
      type: "array",
      items: {
        type: "object",
        properties: {
          day: { type: "string" },
          items: {
            type: "array",
            items: {
              type: "object",
              properties: { time: { type: "string" }, what: { type: "string" } },
              required: ["time", "what"],
              additionalProperties: false,
            },
          },
        },
        required: ["day", "items"],
        additionalProperties: false,
      },
    },
    tip: { type: "string" },
  },
  required: ["title", "days", "tip"],
  additionalProperties: false,
};

async function aiPlan(place) {
  const res = await client.beta.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    output_config: { effort: "low", format: { type: "json_schema", schema: PLAN_SCHEMA } },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    messages: [{
      role: "user",
      content: `국내 여행지 "${place}"로 주말 1박 2일 여행 일정을 짜줘. 실제 존재하는 명소·음식 위주로, 시간대별로 각 날 4~6개 항목, time은 24시간 HH:MM 형식, day는 "1일차"/"2일차". tip에는 한 줄 팁.`,
    }],
  });
  if (res.stop_reason === "refusal") throw new Error("AI가 요청을 거절했어요");
  const text = res.content.find((b) => b.type === "text")?.text;
  return JSON.parse(text);
}

export default async function handler(req, res) {
  const url = new URL(req.url, "http://x");
  const place = (url.searchParams.get("place") || "").slice(0, 30);
  if (!place) return res.writeHead(400).end("place 필요");
  try {
    if (!client) return res.writeHead(503).end("no api key"); // 클라이언트가 샘플 일정으로 대체
    const plan = await aiPlan(place);
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(plan));
  } catch (e) {
    console.error(e);
    res.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ error: e.message }));
  }
}
