// A3 내 여행 저장 점검: `npx vite preview --port 4173` 띄운 상태에서 `node a3.mjs` (실제 Supabase, 테스트 계정 2개 · 캡처는 shots/A3)
// 계정: A3_A / A3_B 환경변수 "이메일:비밀번호" (기본값은 테스트 계정). 만든 trip은 끝에 지운다
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import assert from "node:assert";
import fs from "node:fs";
import { SB_URL, SB_KEY } from "./src/supabase.js";

const B = process.env.BASE || "http://localhost:4173", dir = "shots/A3";
fs.mkdirSync(dir, { recursive: true });
const login = async (cred) => {
  const [email, password] = cred.split(":");
  const c = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return { c, session: data.session };
};
const A = await login(process.env.A3_A || "a3-a@eodigaji.test:a3-test-pw-1");
const Bu = await login(process.env.A3_B || "a3-b@eodigaji.test:a3-test-pw-2");
const until = async (fn, msg) => { for (let t = 0; t < 40; t++) { if (await fn()) return; await new Promise((r) => setTimeout(r, 250)); } assert.fail(msg); };

const browser = await chromium.launch();
const open = async (session, width = 390) => {
  const ctx = await browser.newContext({ viewport: { width, height: width > 500 ? 800 : 844 }, deviceScaleFactor: 2, permissions: ["clipboard-read", "clipboard-write"] });
  await ctx.addInitScript(() => { delete Navigator.prototype.share; });
  if (session) await ctx.addInitScript((s) => localStorage.setItem("sb-ltbhffozitpbsxjbnbnd-auth-token", JSON.stringify(s)), session);
  const page = await ctx.newPage();
  page.errs = []; page.on("pageerror", (e) => page.errs.push(e.message));
  return page;
};
const whats = (p) => p.locator(".what").evaluateAll((els) => els.map((e) => e.value));

// 1. 비로그인으로 뽑고 고친 뒤 [저장] → 로그인 요구
const out = await open(null);
await out.goto(B); await out.waitForSelector("#regions path");
await out.click("#spin"); await out.waitForSelector("#go:not([hidden])", { timeout: 15000 });
await out.click("#go"); await out.waitForSelector("#planBody .row");
await out.screenshot({ path: `${dir}/mobile-1-unsaved.png`, fullPage: true });
await out.click("#save"); await out.waitForSelector("#login");
assert.match(out.url(), /\/login\?next=%2Fplan%3Fr%3D/);
const local = new URL(decodeURIComponent(out.url().split("next=")[1]), B).pathname + new URL(decodeURIComponent(out.url().split("next=")[1]), B).search;

// 2. A가 같은 일정(고친 내용 그대로)을 로그인 후 저장
const a = await open(A.session);
await a.goto(B + local); await a.waitForSelector("#planBody .row");
await a.fill("#planTitle", "A3 점검 여행");
await a.locator(".what").nth(0).fill("저장 전에 고친 일정");
await a.click("#save");
await until(() => a.url().includes("/plan/"), "저장 후 주소가 안 바뀜");
const id = a.url().split("/plan/")[1];
assert.match(await a.textContent("#planNote"), /저장됨/);
assert.equal(await a.isHidden("#save"), true);
await a.screenshot({ path: `${dir}/mobile-2-saved.png`, fullPage: true });
const saved = await whats(a);

// 3. /me 목록 + 다른 기기(새 브라우저, 같은 계정)
await a.goto(B + "/me"); await a.waitForSelector(".trips a");
assert.match(await a.textContent(".trips"), /A3 점검 여행/);
await a.screenshot({ path: `${dir}/mobile-3-me.png`, fullPage: true });
const pc = await open(A.session, 1280);
await pc.goto(B + "/me"); await pc.waitForSelector(".trips a");
await pc.screenshot({ path: `${dir}/pc-3-me.png` });
await pc.click(`.trips a[href="/plan/${id}"]`); await pc.waitForSelector("#planBody .row");
assert.deepEqual(await whats(pc), saved);
assert.equal(await pc.inputValue("#planTitle"), "A3 점검 여행");
await pc.screenshot({ path: `${dir}/pc-4-other-device.png` });

// 4. 남의 trip id로 직접 요청 → 막힘 (읽기·쓰기·끼어들기 전부)
assert.equal((await Bu.c.from("trips").select().eq("id", id)).data.length, 0);
assert.equal((await Bu.c.from("items").select().eq("trip_id", id)).data.length, 0);
await Bu.c.from("items").insert({ trip_id: id, day: 0, what: "침입" });
await Bu.c.from("trips").update({ title: "침입" }).eq("id", id);
assert.equal((await A.c.from("trips").select("title").eq("id", id).single()).data.title, "A3 점검 여행");
assert.equal((await A.c.from("items").select().eq("trip_id", id)).data.length, saved.length);
assert.equal((await Bu.c.rpc("join_trip", { tid: id })).data, false);  // 공유 안 한 여행은 링크로도 못 들어옴
const anon = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
assert.equal((await anon.from("trips").select().eq("id", id)).data?.length ?? 0, 0);
const bp = await open(Bu.session);
await bp.goto(B + "/plan/" + id);
await until(async () => (await bp.textContent("#planBody")).includes("찾을 수 없어요"), "남의 비공유 trip이 열림");

// 5. 비로그인으로 링크 열면 로그인 안내
await out.goto(B + "/plan/" + id);
await until(async () => (await out.textContent("#planBody")).includes("로그인하면"), "비로그인 안내 없음");

// 6. A가 [친구 초대] → B가 링크로 들어와 멤버가 됨 (A4 전까지 임시: 공유한 trip id = 초대)
await a.goto(B + "/plan/" + id); await a.waitForSelector("#planBody .row");
await a.click("#invite");
await until(async () => /같이 고치는 중|복사/.test(await a.textContent("#planNote")), "초대 안 됨");
await bp.goto(B + "/plan/" + id); await bp.waitForSelector("#planBody .row");
assert.deepEqual(await whats(bp), saved);
await bp.locator(".what").nth(0).fill("B가 고친 일정");
await bp.locator("#planTitle").focus();
await until(async () => (await whats(a))[0] === "B가 고친 일정", "B 수정이 A에 안 옴");
await bp.screenshot({ path: `${dir}/mobile-5-friend.png`, fullPage: true });

for (const p of [out, a, pc, bp]) assert.deepEqual(p.errs, []);
await A.c.from("trips").delete().eq("id", id); // 정리
assert.equal((await A.c.from("items").select().eq("trip_id", id)).data.length, 0);
await browser.close();
console.log("OK", id);
