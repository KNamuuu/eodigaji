// B2 뽑기 필터 점검: `npx vite preview --port 4173` 띄운 상태에서 `node filter.mjs` (캡처는 shots/B2)
// 룰렛 100번(가짜 시계로 빨리 감기) · 다트로 뺀 곳 맞히기 · 로그인 계정의 "내 여행에 있는 곳 빼기"
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import assert from "node:assert";
import fs from "node:fs";
import { SB_URL, SB_KEY } from "./src/supabase.js";

const B = process.env.BASE || "http://localhost:4173", dir = "shots/B2";
fs.mkdirSync(dir, { recursive: true });
const browser = await chromium.launch();
const open = async (width, { session, clock } = {}) => {
  const ctx = await browser.newContext({ viewport: { width, height: width > 500 ? 800 : 844 }, deviceScaleFactor: 2 });
  if (session) await ctx.addInitScript((s) => localStorage.setItem("sb-ltbhffozitpbsxjbnbnd-auth-token", JSON.stringify(s)), session);
  const page = await ctx.newPage();
  page.errs = []; page.on("pageerror", (e) => page.errs.push(e.message));
  if (clock) await page.clock.install();
  await page.goto(B); await page.waitForSelector("#regions path");
  await page.click(".filter summary");
  return page;
};
const chip = (page, prov) => page.click(`.chips button:text-is("${prov}")`);
async function spin100(page, ok) {
  const seen = {};
  for (let i = 0; i < 100; i++) {
    await page.click("#spin");
    await page.clock.runFor(10000);
    const [prov, name] = await page.evaluate(() => [".result .prov", ".result .name"].map((s) => document.querySelector(s)?.textContent));
    assert.ok(name && ok(prov, name), `${i + 1}번째에 뺀 곳이 뽑힘: ${prov} ${name}`);
    seen[name] = (seen[name] || 0) + 1;
  }
  return seen;
}

// 1. 도 선택: 강원·제주만 → 100번 다 강원·제주, 나머지 147곳은 흐리게
const p1 = await open(390, { clock: true });
await chip(p1, "강원"); await chip(p1, "제주");
assert.equal(await p1.locator("#regions path.out").count(), 167 - 20);
assert.match(await p1.textContent(".filter summary"), /20곳/);
await p1.clock.runFor(1500);
await p1.screenshot({ path: `${dir}/mobile-1-filter.png`, fullPage: true });
const seen1 = await spin100(p1, (prov) => prov === "강원" || prov === "제주");
console.log("도 선택 100번:", Object.keys(seen1).length, "곳 나옴");
await p1.screenshot({ path: `${dir}/mobile-2-picked.png`, fullPage: true });
assert.deepEqual(p1.errs, []);

// 2. 다트: 제주만 남기고 서울에 던지면 안 뽑힘, 제주에 던지면 뽑힘 (바람 0)
for (const [tag, width] of [["mobile", 390], ["pc", 1280]]) {
  const page = await open(width);
  await chip(page, "제주");
  await page.evaluate(() => { Math.random = () => 0; }); // 바람 0, 손 떨림은 한쪽으로 고정
  await page.click("[data-mode=dart]"); await page.waitForSelector("#dart");
  const d = await page.evaluate(() => fetch("/regions.json").then((r) => r.json()));
  const REST = [200, d.h + 46], FAR = REST[1] - 10, MAX = 130;
  const toScreen = (x, y) => page.evaluate(([x, y]) => {
    const svg = document.querySelector("#map"), pt = svg.createSVGPoint(); pt.x = x; pt.y = y;
    const p = pt.matrixTransform(svg.getScreenCTM()); return [p.x, p.y];
  }, [x, y]);
  async function throwAt(name) {
    const r = d.regions.find((r) => r.name === name);
    const dx = r.cx - REST[0], dy = r.cy - REST[1], dist = Math.hypot(dx, dy), len = (dist - 20) / (FAR - 20) * MAX;
    const a = await toScreen(REST[0], REST[1] + 20), b = await toScreen(REST[0] - dx / dist * len, REST[1] + 20 - dy / dist * len);
    await page.mouse.move(...a); await page.mouse.down(); await page.mouse.move(...b, { steps: 8 }); await page.mouse.up();
    await page.waitForFunction(() => !document.querySelector("#status").textContent.startsWith("힘"), null, { timeout: 5000 });
    await page.waitForTimeout(600);
  }
  await throwAt("서울");
  assert.match(await page.textContent("#status"), /필터에서 뺀 곳/);
  assert.equal(await page.isVisible("#go"), false, "뺀 곳인데 일정 짜기 버튼이 뜸");
  await page.screenshot({ path: `${dir}/${tag}-3-dart-out.png` });
  await page.waitForTimeout(1000); // 다트 돌아옴
  await page.evaluate(() => { Math.random = () => 0; });
  await throwAt("제주시");
  assert.equal(await page.evaluate(() => document.querySelector(".result .name")?.textContent), "제주시");
  await page.screenshot({ path: `${dir}/${tag}-4-dart-hit.png` });
  assert.deepEqual(page.errs, []);
  await page.context().close();
}

// 3. 로그인: 강원 + 내 여행(춘천시) 빼기 → 100번 중 춘천 0번
const { data: { session } } = await createClient(SB_URL, SB_KEY, { auth: { persistSession: false } })
  .auth.signInWithPassword({ email: "a3-a@eodigaji.test", password: process.env.A3_A_PW || "a3-test-pw-1" });
const c = createClient(SB_URL, SB_KEY, { auth: { persistSession: false }, global: { headers: { Authorization: "Bearer " + session.access_token } } });
const id = crypto.randomUUID();
{ const { error } = await c.from("trips").insert({ id, owner_id: session.user.id, prov: "강원", place: "춘천시", title: "B2 점검" }); assert.ifError(error); }
try {
  const p3 = await open(1280, { session, clock: true });
  await chip(p3, "강원");
  await p3.check(".check input");
  await p3.waitForFunction(() => document.querySelectorAll("#regions path.out").length === 167 - 17);
  await p3.clock.runFor(1500); // 흐려지는 전환(.9초) 끝나고
  await p3.screenshot({ path: `${dir}/pc-5-skip-mine.png` });
  const seen3 = await spin100(p3, (prov, name) => prov === "강원" && name !== "춘천시");
  console.log("내 여행 빼기 100번:", Object.keys(seen3).length, "곳 나옴");
  assert.deepEqual(p3.errs, []);
} finally {
  await c.from("trips").delete().eq("id", id);
}

await browser.close();
console.log(`OK → ${dir}/`);
