// D1 모두의 후기 + 신고 점검: `npx vite preview --port 4173` 띄운 상태에서 `node d1.mjs` (실제 Supabase, 테스트 계정 4개 · 캡처는 shots/D1)
// b가 강릉에 공개·비공개 기록 → a가 "모두의 후기"에서 공개만 봄 · 화면에서 신고 → c·d도 신고(3건) → 숨겨져 a·c에겐 안 보이고 작성자 b에겐 남음. 만든 것은 끝에 지운다
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import assert from "node:assert";
import fs from "node:fs";
import { SB_URL, SB_KEY } from "./src/supabase.js";

const B = process.env.BASE || "http://localhost:4173", dir = "shots/D1";
fs.mkdirSync(dir, { recursive: true });
const login = async (cred) => {
  const [email, password] = cred.split(":");
  const c = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return { c, session: data.session, uid: data.session.user.id };
};
const A = await login("a3-a@eodigaji.test:a3-test-pw-1"), Bu = await login("a3-b@eodigaji.test:a3-test-pw-2");
const C = await login("d1-c@eodigaji.test:d1-test-pw-3"), D = await login("d1-d@eodigaji.test:d1-test-pw-4");
const regions = JSON.parse(fs.readFileSync("public/regions.json")).regions;
const gn = regions.find((r) => r.prov === "강원" && r.name === "강릉시");
const hex = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
for (const u of [A, Bu]) await u.c.from("trips").delete().like("title", "D1 %"); // 지난 실패 실행이 남긴 것

const trip = hex();
assert.ifError((await Bu.c.from("trips").insert({ id: trip, owner_id: Bu.uid, prov: "강원", place: "강릉시", title: "D1 강릉", status: "done", done_on: "2026-09-27" })).error);
const post = async (body, pub) => {
  const id = crypto.randomUUID();
  assert.ifError((await Bu.c.from("posts").insert({ id, trip_id: trip, prov: "강원", place: "강릉시", body, is_public: pub })).error);
  return id;
};

// 작성자는 hidden을 직접 못 바꿈, 자기 기록은 신고 못 함
const own = await post("D1 내 기록 신고 시도", true);
assert.ok((await Bu.c.from("posts").update({ hidden: true }).eq("id", own)).error, "작성자가 hidden을 바꿈");
assert.ok((await Bu.c.from("reports").insert({ post_id: own, reason: "etc" })).error, "자기 기록을 신고함");
await Bu.c.from("posts").delete().eq("id", own);

const browser = await chromium.launch();
for (const [width, mobile, tag] of [[1280, false, "pc"], [390, true, "mobile"]]) {
  const pub = await post(`D1 공개 후기 ${tag}`, true), priv = await post(`D1 비공개 ${tag}`, false);
  const ctx = await browser.newContext({ viewport: { width, height: mobile ? 844 : 800 }, deviceScaleFactor: 2, hasTouch: mobile, isMobile: mobile });
  await ctx.addInitScript((s) => localStorage.setItem("sb-ltbhffozitpbsxjbnbnd-auth-token", JSON.stringify(s)), A.session);
  const p = await ctx.newPage(), errs = [];
  p.on("pageerror", (e) => errs.push(e.message));

  // 1. 내 기록 탭엔 남의 것 없음 → 모두의 후기: 공개만
  await p.goto(`${B}/region/${gn.id}`);
  await p.waitForSelector("text=아직 이 지역 기록이 없어요");
  await p.click('[data-tab="all"]');
  const li = `li[data-post="${pub}"]`;
  await p.waitForSelector(li);
  assert.equal(await p.$(`li[data-post="${priv}"]`), null, "비공개가 보임");
  assert.match(await p.textContent(li), /\d{4}-\d\d-\d\d · 공개 · 다른 사람/);
  await p.screenshot({ path: `${dir}/${tag}-1-all.png`, fullPage: mobile });

  // 2. 화면에서 신고 → 사유 → "신고했어요"
  await p.click(`${li} .acts button:text("신고")`);
  await p.screenshot({ path: `${dir}/${tag}-2-reason.png`, fullPage: mobile });
  await p.click(`${li} [data-reason="spam"]`);
  await p.waitForSelector(`${li} small:text("신고했어요")`);
  await p.screenshot({ path: `${dir}/${tag}-3-reported.png`, fullPage: mobile });
  assert.equal((await A.c.from("posts").select("hidden").eq("id", pub).single()).data.hidden, false, "1건에 숨겨짐");

  // 3. 두 명 더 → 3건 → 숨김
  for (const u of [C, D]) assert.ifError((await u.c.from("reports").insert({ post_id: pub, reason: "abuse" })).error);
  assert.equal((await C.c.from("posts").select("id").eq("id", pub)).data.length, 0, "숨긴 기록이 남에게 보임");
  assert.deepEqual((await Bu.c.from("posts").select("hidden").eq("id", pub).single()).data, { hidden: true }, "작성자에게서도 사라짐");
  await p.reload();
  await p.click('[data-tab="all"]');
  await p.waitForSelector("text=아직 이 지역에 공개된 후기가 없어요");
  await p.screenshot({ path: `${dir}/${tag}-4-hidden.png`, fullPage: mobile });

  assert.deepEqual(errs, []);
  await ctx.close();
  console.log(tag, "OK");
}
await browser.close();
assert.ifError((await Bu.c.from("trips").delete().eq("id", trip)).error);
console.log("OK");
