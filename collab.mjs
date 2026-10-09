// 사용: 서버 띄운 상태에서 `node collab.mjs [v3]` (배포본: BASE=https://eodigaji.vercel.app)  — 두 브라우저로 초대·동시 편집 점검 (실제 Supabase 사용)
import { chromium } from "playwright";
import assert from "node:assert";
import fs from "node:fs";

const BASE = process.env.BASE || "http://localhost:3000";
const dir = `shots/${process.argv[2] || "v3"}`;
fs.mkdirSync(dir, { recursive: true });
const browser = await chromium.launch();
const open = async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, permissions: ["clipboard-read", "clipboard-write"] });
  await ctx.addInitScript(() => { delete Navigator.prototype.share; });
  return ctx.newPage();
};
const until = async (fn, msg) => { for (let t = 0; t < 40; t++) { if (await fn()) return; await new Promise((r) => setTimeout(r, 250)); } assert.fail(msg); };
const whats = (p) => p.locator(".what").evaluateAll((els) => els.map((e) => e.value));

// A: 뽑고 일정 열고 초대
const a = await open();
await a.goto(BASE);
await a.waitForSelector("#regions path");
await a.click("#spin");
await a.waitForSelector("#go:not([hidden])", { timeout: 15000 });
await a.click("#go");
await a.waitForSelector("#planBody .row");
await a.fill("#planTitle", "친구랑 가는 여행");
await a.click("#invite");
await until(() => a.url().includes("?plan="), "초대 링크가 안 생김");
const link = a.url();
assert.match(await a.textContent("#planNote"), /같이 고치는 중|복사/);
await a.screenshot({ path: `${dir}/01-invited.png` });

// B: 링크로 들어옴 → 같은 일정
const b = await open();
await b.goto(link);
await b.waitForSelector("#planBody .row");
assert.equal(await b.inputValue("#planTitle"), "친구랑 가는 여행");
assert.deepEqual(await whats(b), await whats(a));

// B가 고치면 A에 반영
await b.locator(".what").nth(0).fill("B가 고친 일정");
await b.locator("[data-add='1']").click();
await b.locator(".what").last().fill("B가 추가한 일정");
await b.locator("#planTitle").focus();           // 입력칸에서 빠져나와야 남에게 간다 (보내는 건 즉시)
await until(async () => (await whats(a)).includes("B가 추가한 일정") && (await whats(a))[0] === "B가 고친 일정", "B 수정이 A에 안 옴");

// A가 지우면 B에 반영
await a.locator("[data-del]").nth(1).click();
await b.locator("#planTitle").blur();
await until(async () => (await whats(b)).length === (await whats(a)).length, "A 삭제가 B에 안 옴");
assert.deepEqual(await whats(b), await whats(a));
await b.screenshot({ path: `${dir}/02-friend-sees-edits.png`, fullPage: true });

// 새로고침해도 DB에서 그대로
await b.reload();
await b.waitForSelector("#planBody .row");
assert.deepEqual(await whats(b), await whats(a));

// 없는 링크
const c = await open();
await c.goto(BASE + "/?plan=nopenopenopenope");
await until(async () => (await c.textContent("#planBody")).includes("찾을 수 없어요"), "없는 링크 처리 안 됨");

await browser.close();
console.log("OK", link);
