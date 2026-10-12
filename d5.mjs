// D5 남의 일정 보기 점검: `npx vite preview --port 4173` 띄운 상태에서 `node d5.mjs` (실제 Supabase, a3-a·a3-b 테스트 계정 · 캡처는 shots/D5)
// a: 강릉 공개 일정 + 비공개 일정 → b: API로 공개만 읽힘(비공개 trip·items 안 읽힘, 고치기 안 됨) · 내 목록엔 안 섞임
// b 390px: /region 강릉 [다른 사람 일정] → 펼침 → [이 일정으로 짜기] → 내 일정 고쳐도 원본 그대로 → [신고]
// a: [다녀왔어요]에서 "이 일정도 공개" → is_public, 다녀온 뒤 토글로 끔. 만든 것은 끝에 지운다
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import assert from "node:assert";
import fs from "node:fs";
import { SB_URL, SB_KEY } from "./src/supabase.js";

const B = process.env.BASE || "http://localhost:4173", dir = "shots/D5";
fs.mkdirSync(dir, { recursive: true });
const login = async (cred) => {
  const [email, password] = cred.split(":"), c = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  assert.ifError(error);
  return { c, session: data.session, uid: data.session.user.id };
};
const A = await login(process.env.A3_A || "a3-a@eodigaji.test:a3-test-pw-1"), Bu = await login(process.env.A3_B || "a3-b@eodigaji.test:a3-test-pw-2");
const ok = (r) => (assert.ifError(r.error), r.data), hex = () => crypto.randomUUID().replaceAll("-", "");
for (const u of [A, Bu]) await u.c.from("trips").delete().like("title", "D5 %");

const pub = hex(), priv = hex(), later = hex();
ok(await A.c.from("trips").insert([
  { id: pub, owner_id: A.uid, prov: "강원", place: "강릉시", title: "D5 강릉 바다 1박", tip: "D5 팁: 안목해변은 아침에", status: "done", done_on: "2026-09-20", is_public: true },
  { id: priv, owner_id: A.uid, prov: "강원", place: "강릉시", title: "D5 비공개", status: "done", done_on: "2026-09-21" },
  { id: later, owner_id: A.uid, prov: "강원", place: "속초시", title: "D5 속초" },
], { defaultToNull: false }));
ok(await A.c.from("items").insert([
  { trip_id: pub, day: 0, time: "10:00", what: "D5 강릉역 도착" }, { trip_id: pub, day: 0, time: "13:00", what: "D5 초당순두부" },
  { trip_id: pub, day: 1, time: "09:00", what: "D5 안목해변 커피" }, { trip_id: priv, day: 0, time: "11:00", what: "D5 비밀 장소" },
]));

// API: b는 공개만, 그것도 public_trips RPC로만 (테이블로는 남의 trip·items가 아예 안 읽힘 → owner_id 안 샘)
assert.deepEqual(ok(await Bu.c.from("trips").select("id").in("id", [pub, priv])), [], "남의 trip이 테이블로 읽힘");
assert.deepEqual(ok(await Bu.c.from("items").select("id").in("trip_id", [pub, priv])), [], "남의 items가 테이블로 읽힘");
const rows = ok(await Bu.c.rpc("public_trips", { p_prov: "강원", p_place: "강릉시" })).filter((t) => [pub, priv].includes(t.id));
assert.deepEqual(rows.map((t) => t.id), [pub], "비공개 일정이 RPC로 읽힘");
assert.equal(rows[0].items.length, 3);
assert.ok(!("owner_id" in rows[0]), "RPC가 owner_id를 내보냄");
ok(await Bu.c.from("trips").update({ title: "D5 남이 고침" }).eq("id", pub)); // RLS: 0행
ok(await Bu.c.from("items").update({ what: "D5 남이 고침" }).eq("trip_id", pub));
assert.equal(ok(await A.c.from("trips").select("title").eq("id", pub).single()).title, "D5 강릉 바다 1박", "남이 trip을 고침");
assert.ok(!ok(await A.c.from("items").select("what").eq("trip_id", pub)).some((i) => i.what.includes("남이")), "남이 items를 고침");
assert.ok((await A.c.from("trips").update({ hidden: false }).eq("id", pub)).error, "hidden을 직접 고칠 수 있음");
const bMine = ok(await Bu.c.from("trips").select("id, trip_members!inner(user_id)")).map((t) => t.id);
assert.ok(!bMine.includes(pub), "내 여행 목록에 남의 공개 일정이 섞임");

const regs = JSON.parse(fs.readFileSync("public/regions.json", "utf8")).regions, gn = regs.find((r) => r.prov === "강원" && r.name === "강릉시").id;
const browser = await chromium.launch(), copies = [];
const ctxFor = async (u) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await ctx.addInitScript((s) => localStorage.setItem("sb-ltbhffozitpbsxjbnbnd-auth-token", JSON.stringify(s)), u.session);
  const p = await ctx.newPage(), errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  return { ctx, p, errs };
};
try {
  // b: 지역 → 다른 사람 일정
  const { ctx, p, errs } = await ctxFor(Bu);
  await p.goto(`${B}/region/${gn}`);
  await p.click('[data-tab="trips"]');
  await p.waitForSelector(`[data-trip="${pub}"]`);
  assert.equal(await p.$(`[data-trip="${priv}"]`), null, "비공개 일정이 목록에 보임");
  await p.screenshot({ path: `${dir}/mobile-list.png`, fullPage: true });
  await p.click(`[data-trip="${pub}"] > button`);
  const txt = await p.textContent(`[data-trip="${pub}"] .ro`);
  for (const s of ["1일차", "2일차", "D5 초당순두부", "D5 안목해변 커피", "D5 팁"]) assert.ok(txt.includes(s), s + " 없음");
  assert.ok(!(await p.textContent("#region")).includes("점검"), "작성자 이름이 보임"); // a3 계정 닉네임은 "점검A"
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "가로 넘침");
  await p.screenshot({ path: `${dir}/mobile-open.png`, fullPage: true });

  // 이 일정으로 짜기 → 내 trip → 고쳐도 원본 그대로
  await p.click(`[data-trip="${pub}"] .copy`);
  await p.waitForURL(/\/plan\/[0-9a-f]{32}$/);
  const mineId = p.url().split("/").pop(); copies.push(mineId);
  await p.waitForSelector("#planBody .what");
  assert.equal(await p.inputValue("#planTitle"), "D5 강릉 바다 1박");
  assert.deepEqual(await p.$$eval("#planBody .what", (els) => els.map((e) => e.value)), ["D5 강릉역 도착", "D5 초당순두부", "D5 안목해변 커피"]);
  await p.fill("#planBody .what >> nth=0", "D5 내가 바꾼 첫 일정");
  await p.waitForTimeout(1500);
  assert.equal(ok(await Bu.c.from("items").select("what").eq("trip_id", mineId).eq("day", 0).eq("time", "10:00").single()).what, "D5 내가 바꾼 첫 일정");
  assert.ok(ok(await A.c.from("items").select("what").eq("trip_id", pub)).some((i) => i.what === "D5 강릉역 도착"), "원본이 바뀜");
  assert.equal(ok(await Bu.c.from("trips").select("owner_id, is_public").eq("id", mineId).single()).is_public, false, "복사본이 공개로 시작함");
  await p.screenshot({ path: `${dir}/mobile-copied.png` });

  // 신고 (복사본은 내 것이라 목록엔 원본만)
  await p.goto(`${B}/region/${gn}`);
  await p.click('[data-tab="trips"]');
  await p.waitForSelector(`[data-trip="${pub}"]`);
  assert.equal(await p.$(`[data-trip="${mineId}"]`), null, "내 복사본이 남의 일정에 보임");
  await p.click(`[data-trip="${pub}"] > button`);
  await p.click(`[data-trip="${pub}"] .acts button:text("일정 신고")`);
  await p.click(`[data-trip="${pub}"] [data-reason="spam"]`);
  await p.waitForSelector(`[data-trip="${pub}"] .acts small`);
  assert.equal(ok(await Bu.c.from("reports").select("reason").eq("trip_id", pub)).length, 1);
  assert.ok((await Bu.c.from("reports").insert({ trip_id: mineId, reason: "spam" })).error, "내 일정을 신고할 수 있음");
  await p.screenshot({ path: `${dir}/mobile-reported.png`, fullPage: true });
  assert.deepEqual(errs, []);
  await ctx.close();

  // a: 다녀옴 저장할 때 공개 → 토글로 끔
  const a = await ctxFor(A);
  await a.p.goto(`${B}/plan/${later}`);
  await a.p.click("#done");
  await a.p.check('#recordForm input[name="tripPublic"]');
  await a.p.screenshot({ path: `${dir}/mobile-done-form.png`, fullPage: true });
  await a.p.click("#recordForm .btn:not(.sub)");
  await a.p.waitForSelector("#tripPublic input:checked");
  assert.equal(ok(await A.c.from("trips").select("is_public").eq("id", later).single()).is_public, true);
  await a.p.uncheck("#tripPublic input");
  for (let i = 0; i < 10 && ok(await A.c.from("trips").select("is_public").eq("id", later).single()).is_public; i++) await a.p.waitForTimeout(300);
  assert.equal(ok(await A.c.from("trips").select("is_public").eq("id", later).single()).is_public, false, "토글로 안 꺼짐");
  assert.deepEqual(a.errs, []);
  await a.ctx.close();
} finally {
  await browser.close();
  await A.c.from("trips").delete().in("id", [pub, priv, later]);
  if (copies.length) await Bu.c.from("trips").delete().in("id", copies);
}
console.log("OK");
