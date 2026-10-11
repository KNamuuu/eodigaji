// A4 친구 초대 점검: 서버 띄운 상태에서 `node collab.mjs [폴더]` (기본 shots/A4, 배포본: BASE=https://eodigaji.vercel.app)
// 두 계정(A3_A·A3_B, a3.mjs와 같음)으로 초대 → 비로그인이면 로그인 → 수락 → 아바타 → 동시 편집. 실제 Supabase, 만든 trip은 끝에 지운다
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import assert from "node:assert";
import fs from "node:fs";
import { SB_URL, SB_KEY } from "./src/supabase.js";

const BASE = process.env.BASE || "http://localhost:4173";
const dir = `shots/${process.argv[2] || "A4"}`;
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
const KEY = "sb-ltbhffozitpbsxjbnbnd-auth-token";
const browser = await chromium.launch();
const open = async (session) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, permissions: ["clipboard-read", "clipboard-write"] });
  await ctx.addInitScript(() => { delete Navigator.prototype.share; });
  if (session) await ctx.addInitScript(([k, s]) => localStorage.getItem(k) || localStorage.setItem(k, JSON.stringify(s)), [KEY, session]);
  const page = await ctx.newPage();
  page.errs = []; page.on("pageerror", (e) => page.errs.push(e.message));
  return page;
};
const until = async (fn, msg) => { for (let t = 0; t < 40; t++) { if (await fn()) return; await new Promise((r) => setTimeout(r, 250)); } assert.fail(msg); };
const whats = (p) => p.locator(".what").evaluateAll((els) => els.map((e) => e.value));

// A: 뽑고 일정 열고 초대 (저장 안 된 일정이면 저장부터)
const a = await open(A.session);
await a.goto(BASE); await a.waitForSelector("#regions path");
await a.click("#spin"); await a.waitForSelector("#go:not([hidden])", { timeout: 15000 });
await a.click("#go"); await a.waitForSelector("#planBody .row");
await a.fill("#planTitle", "친구랑 가는 여행");
await a.click("#invite");
await until(async () => /복사/.test(await a.textContent("#planNote")), "초대 링크가 안 생김");
const link = await a.evaluate(() => navigator.clipboard.readText());
assert.match(link, /\/invite\/[0-9a-f]{32}$/);
const id = a.url().split("/plan/")[1];
assert.equal(await a.locator(".people li").count(), 0); // 아직 혼자
await a.screenshot({ path: `${dir}/01-invited.png` });

// B: 로그인 안 한 채 링크 → 로그인 화면 → (로그인) → 수락 → 같은 일정
const b = await open(null);
await b.goto(link); await b.waitForSelector("#login");
assert.match(b.url(), /\/login\?next=%2Finvite%2F/);
await b.screenshot({ path: `${dir}/02-login-first.png`, fullPage: true });
await b.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [KEY, Bu.session]);
await b.reload();                                   // 이메일 링크로 돌아온 것과 같음: 로그인 상태로 next(/invite/..)
await b.waitForURL(/\/plan\//); await b.waitForSelector("#planBody .row");
assert.equal(b.url().split("/plan/")[1], id);
assert.equal(await b.inputValue("#planTitle"), "친구랑 가는 여행");
assert.deepEqual(await whats(b), await whats(a));

// 아바타: 둘 다 2명 (A는 B가 들어온 걸 실시간으로)
await until(async () => (await b.locator(".people li").count()) === 2, "B 화면 아바타 2명 아님");
await until(async () => (await a.locator(".people li").count()) === 2, "A 화면에 B 아바타가 안 생김");
assert.match(await a.getAttribute(".people li:first-child", "title"), /점검A \(만든 사람\)/);
await a.screenshot({ path: `${dir}/03-avatars.png` });

// 동시 편집: B가 고치면 A에, A가 지우면 B에
await b.locator(".what").nth(0).fill("B가 고친 일정");
await b.locator("[data-add='1']").click();
await b.locator(".what").last().fill("B가 추가한 일정");
await b.locator("#planTitle").focus();
await until(async () => (await whats(a)).includes("B가 추가한 일정") && (await whats(a))[0] === "B가 고친 일정", "B 수정이 A에 안 옴");
await a.locator("[data-del]").nth(1).click();
await b.locator("#planTitle").blur();
await until(async () => (await whats(b)).length === (await whats(a)).length, "A 삭제가 B에 안 옴");
assert.deepEqual(await whats(b), await whats(a));
await b.screenshot({ path: `${dir}/04-friend-sees-edits.png`, fullPage: true });

// 새로고침해도 DB에서 그대로, B의 내 여행 목록에도 생김
await b.reload(); await b.waitForSelector("#planBody .row");
assert.deepEqual(await whats(b), await whats(a));
await b.goto(BASE + "/me"); await b.waitForSelector(".trips a");
assert.match(await b.textContent(".trips"), /친구랑 가는 여행/);

// 잘못된·만료된 링크
await b.goto(BASE + "/invite/" + "0".repeat(32));
await until(async () => (await b.textContent("#invite-page")).includes("만료"), "잘못된 링크 처리 안 됨");
assert.equal((await Bu.c.rpc("accept_invite", { tok: "0".repeat(32) })).data, null);
// 멤버가 아니면 초대 링크를 못 만든다
assert.ok((await createClient(SB_URL, SB_KEY).from("invites").insert({ token: "f".repeat(32), trip_id: id })).error);

for (const p of [a, b]) assert.deepEqual(p.errs, []);
await A.c.from("trips").delete().eq("id", id); // 정리 (멤버·초대·일정 같이 지워짐)
await browser.close();
console.log("OK", id);
