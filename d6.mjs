// D6 다듬기 묶음 점검: `npx vite preview --port 4173` 띄운 상태에서 `node d6.mjs` (실제 Supabase, a3-a·a3-b · 캡처는 shots/D6)
// 신고 관리까지 보려면 a3-a를 잠깐 관리자로: insert into public.admins select id from auth.users where email = 'a3-a@eodigaji.test' → 끝나면 delete. ADMIN=1로 실행
// a: 강릉 공개 일정 2개(하나엔 공개 기록·사진) · b: /plan/<a 일정> 읽기 전용 · ♥ · 따라 짜기 → 숫자 · 인기순 · 사진 격자는 썸네일
// 지역 지도 [+][−][다시 맞추기] · 내 지도 확대 시 이름 글씨 그대로 · 두 번 탭 확대 · 가는 날 → D-day · .ics · 카카오맵 링크 · 50분 뒤 사진 URL 새로 받기
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import assert from "node:assert";
import fs from "node:fs";
import { SB_URL, SB_KEY } from "./src/supabase.js";
import { thumbOf } from "./src/regions.js";

const B = process.env.BASE || "http://localhost:4173", dir = "shots/D6";
fs.mkdirSync(dir, { recursive: true });
const login = async (cred) => {
  const [email, password] = cred.split(":"), c = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  assert.ifError(error);
  return { c, session: data.session, uid: data.session.user.id };
};
const A = await login(process.env.A3_A || "a3-a@eodigaji.test:a3-test-pw-1"), Bu = await login(process.env.A3_B || "a3-b@eodigaji.test:a3-test-pw-2");
const ok = (r) => (assert.ifError(r.error), r.data), hex = () => crypto.randomUUID().replaceAll("-", "");
for (const u of [A, Bu]) await u.c.from("trips").delete().like("title", "D6 %");
const regs = JSON.parse(fs.readFileSync("public/regions.json", "utf8")).regions, gn = regs.find((r) => r.prov === "강원" && r.name === "강릉시").id;

const t1 = hex(), t2 = hex(), mine = hex(), files = [];
ok(await A.c.from("trips").insert([
  { id: t1, owner_id: A.uid, prov: "강원", place: "강릉시", title: "D6 최신 일정", status: "done", done_on: "2026-10-05", is_public: true },
  { id: t2, owner_id: A.uid, prov: "강원", place: "강릉시", title: "D6 인기 일정", status: "done", done_on: "2026-09-01", is_public: true },
  { id: mine, owner_id: A.uid, prov: "강원", place: "강릉시", title: "D6 내 계획" },
], { defaultToNull: false }));
ok(await A.c.from("items").insert([{ trip_id: t2, day: 0, time: "10:00", what: "경포대" }, { trip_id: t2, day: 0, time: "12:00", what: "초당순두부" }, { trip_id: t2, day: 1, time: "", what: "안목해변" },
  { trip_id: mine, day: 0, time: "09:30", what: "강릉역" }, { trip_id: mine, day: 0, time: "", what: "산책" }, { trip_id: mine, day: 1, time: "11:00", what: "오죽헌" }]));
// t2에 공개 기록 (원본 + 썸네일)
const jpg = Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==", "base64");
const post = crypto.randomUUID(), ph = `${A.uid}/${post}/0.jpg`;
for (const p of [ph, thumbOf(ph)]) { ok(await A.c.storage.from("photos").upload(p, jpg, { contentType: "image/jpeg" })); files.push(p); }
ok(await A.c.from("posts").insert({ id: post, trip_id: t2, prov: "강원", place: "강릉시", body: "D6 바다 좋았음", photos: [ph], is_public: true }));

const browser = await chromium.launch(), copies = [];
const ctxFor = async (u, opt = {}) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, acceptDownloads: true, ...opt });
  await ctx.addInitScript((s) => localStorage.setItem("sb-ltbhffozitpbsxjbnbnd-auth-token", JSON.stringify(s)), u.session);
  const p = await ctx.newPage(), errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  return { ctx, p, errs };
};
const vb = (p) => p.evaluate(() => document.querySelector("#map").getAttribute("viewBox").split(" ").map(Number));
try {
  // ── b: /plan/<a의 공개 일정> = 읽기 전용, ♥, 따라 짜기 ──
  const { ctx, p, errs } = await ctxFor(Bu);
  await p.goto(`${B}/plan/${t2}`);
  await p.waitForSelector(".plan-ro .ro");
  assert.equal(await p.$("#planBody .what"), null, "남의 일정에 편집칸이 보임");
  assert.equal(await p.textContent("#planTitle"), "D6 인기 일정");
  assert.equal(await p.getAttribute(".ro .maplink >> nth=0", "href"), "https://map.kakao.com/link/search/" + encodeURIComponent("강릉시 경포대"));
  await p.waitForSelector(".ro .posts .photos img");
  const src = await p.getAttribute(".ro .posts .photos img", "src");
  assert.ok(decodeURIComponent(src).includes("/t0.jpg"), "격자가 원본을 받음: " + src);
  await p.click(".btn.like");
  await p.waitForSelector(".btn.like.on");
  assert.match(await p.textContent(".btn.like"), /♥ 1/);
  await p.screenshot({ path: `${dir}/mobile-plan-readonly.png`, fullPage: true });
  await p.click(".plan-ro .copy");
  await p.waitForURL((u) => /\/plan\/[0-9a-f]{32}$/.test(u.pathname) && !u.pathname.endsWith(t2));
  copies.push(p.url().split("/").pop());
  assert.equal(ok(await Bu.c.from("trips").select("copied_from").eq("id", copies[0]).single()).copied_from, t2);
  assert.ok((await Bu.c.from("trips").insert({ id: hex(), owner_id: Bu.uid, prov: "강원", place: "강릉시", copied_from: mine })).error, "비공개 일정에 따라 짬 숫자를 올릴 수 있음");

  // 지역 [다른 사람 일정]: 인기순이면 t2(♥1·따라짬1)가 위, 최신순이면 t1이 위
  await p.goto(`${B}/region/${gn}`);
  await p.click('[data-tab="trips"]');
  await p.waitForSelector(`[data-trip="${t2}"]`);
  const order = () => p.$$eval(".others > li", (els) => els.map((e) => e.dataset.trip));
  let o = await order();
  assert.ok(o.indexOf(t2) < o.indexOf(t1), "인기순 아님");
  assert.match(await p.textContent(`[data-trip="${t2}"] small`), /♥ 1 · 1명 따라 짬/);
  await p.click('.sort button:text("최신순")');
  await p.waitForFunction(([a, b]) => { const ids = [...document.querySelectorAll(".others > li")].map((e) => e.dataset.trip); return ids.indexOf(a) < ids.indexOf(b); }, [t1, t2]);
  assert.equal(await p.$(".btn.more"), null, "30개 안 되는데 [더 보기]가 보임");
  await p.screenshot({ path: `${dir}/mobile-region-trips.png`, fullPage: true });

  // 지역 지도: [+] → 확대, [다시 맞추기] → 처음 화면
  const home = await vb(p);
  await p.click('.zoom button[aria-label="확대"]');
  const zin = await vb(p);
  assert.ok(zin[2] < home[2] * 0.7, "지역 지도 [+]가 안 됨");
  await p.click("#fit");
  assert.deepEqual(await vb(p), home, "[다시 맞추기]가 처음 화면이 아님");
  await p.click('.zoom button[aria-label="축소"]');
  assert.ok((await vb(p))[2] > home[2], "지역 지도 [−]가 안 됨");
  assert.deepEqual(errs, []);
  await ctx.close();

  // ── a: 내 지도 글씨·두 번 탭, 가는 날·D-day·.ics, 사진 URL 50분 갱신 ──
  const a = await ctxFor(A);
  await a.p.clock.install();
  await a.p.goto(`${B}/plan/${mine}`);
  await a.p.waitForSelector("#planBody .what");
  assert.ok(await a.p.$("#planBody .row .maplink"), "편집 화면에 지도 링크 없음");
  const d3 = new Date(Date.now() + 3 * 864e5 - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
  await a.p.fill('.when input[name="start"]', d3);
  await a.p.waitForSelector(".when b");
  assert.equal(await a.p.textContent(".when b"), "D-3");
  for (let i = 0; i < 10 && ok(await A.c.from("trips").select("start_on").eq("id", mine).single()).start_on !== d3; i++) await a.p.waitForTimeout(300);
  assert.equal(ok(await A.c.from("trips").select("start_on").eq("id", mine).single()).start_on, d3);
  const [dl] = await Promise.all([a.p.waitForEvent("download"), a.p.click("#ics")]);
  const cal = fs.readFileSync(await dl.path(), "utf8"), ymd = (n) => { const t = new Date(d3 + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10).replaceAll("-", ""); };
  fs.writeFileSync(`${dir}/trip.ics`, cal);
  assert.ok(cal.includes(`DTSTART:${ymd(0)}T093000`) && cal.includes(`DTSTART;VALUE=DATE:${ymd(0)}`) && cal.includes(`DTSTART:${ymd(1)}T110000`), "ics 날짜가 틀림:\n" + cal);
  assert.equal((cal.match(/BEGIN:VEVENT/g) || []).length, 3);
  await a.p.screenshot({ path: `${dir}/mobile-plan-when.png` });
  await a.p.goto(`${B}/me`);
  await a.p.waitForSelector(`a[href="/plan/${mine}"]`);
  assert.match(await a.p.textContent(`a[href="/plan/${mine}"] small`), /D-3/);

  // 공유 시트: 초대 → [링크 복사]·[다른 앱] (카카오 키 없으면 카카오 버튼 없음)
  await a.p.goto(`${B}/plan/${mine}`);
  await a.p.waitForSelector("#planBody .what");
  await a.p.click("#invite");
  await a.p.waitForSelector('.sheet[open] [data-share="copy"]');
  await a.p.screenshot({ path: `${dir}/mobile-invite-sheet.png` });
  await a.p.click(".sheet .btn.sub");

  // 내 지도: 다녀온 곳(강릉, 사진) 하나 만들고 → 확대해도 이름 글씨 크기 그대로 · 바다 두 번 탭 = 2배
  ok(await A.c.from("trips").update({ status: "done", done_on: "2026-10-01" }).eq("id", mine));
  await a.p.goto(`${B}/me`);
  await a.p.waitForSelector("#regions path.visited");
  const label = () => a.p.evaluate(() => { const t = document.querySelector("#labels text"); return t && t.getBoundingClientRect().height; });
  await a.p.click("#regions path.visited >> nth=0", { force: true });
  await a.p.waitForSelector("#labels text");
  const h0 = await label(), v0 = await vb(a.p);
  for (let i = 0; i < 3; i++) await a.p.click('.zoom button[aria-label="확대"]');
  assert.ok((await vb(a.p))[2] < v0[2] / 3, "[+] 확대 안 됨");
  await a.p.locator("#regions path[tabindex] >> nth=0").dispatchEvent("click"); // [+]로 포커스가 빠져 미리보기가 닫혔으니 다시 (가운데 확대라 강릉은 화면 밖)
  await a.p.waitForSelector("#labels text");
  const h1 = await label();
  assert.ok(Math.abs(h1 - h0) < 2, `확대하면 글씨가 커짐 ${h0} → ${h1}`);
  await a.p.screenshot({ path: `${dir}/mobile-me-zoom-label.png` });
  await a.p.click("#fit");
  const box = await a.p.locator("#map").boundingBox(), sea = [box.x + 20, box.y + box.height - 20];
  await a.p.touchscreen.tap(...sea); await a.p.waitForTimeout(80); await a.p.touchscreen.tap(...sea);
  await a.p.waitForFunction((w) => +document.querySelector("#map").getAttribute("viewBox").split(" ")[2] < w * 0.6, v0[2]);

  // 50분 뒤: 사진 서명 URL을 다시 받음
  const signs = [];
  a.p.on("request", (r) => r.url().includes("/object/sign/photos") && signs.push(r.url()));
  await a.p.goto(`${B}/plan/${t2}`); // a는 멤버 → 편집 화면 + 기록(사진)
  await a.p.waitForSelector(".posts .photos img");
  const before = signs.length;
  await a.p.clock.fastForward("51:00");
  await a.p.waitForFunction((n) => performance.getEntriesByType("resource").filter((e) => e.name.includes("/object/sign/photos")).length > n, before, { timeout: 5000 }).catch(() => {});
  for (let i = 0; i < 20 && signs.length <= before; i++) await a.p.waitForTimeout(200);
  assert.ok(signs.length > before, "50분 지나도 사진 URL을 다시 안 받음");
  assert.deepEqual(a.errs, []);
  await a.ctx.close();

  // ── 신고 관리 ──
  const nb = await ctxFor(Bu);
  ok(await Bu.c.from("reports").insert({ trip_id: t1, reason: "spam" }));
  await nb.p.goto(`${B}/admin`);
  await nb.p.waitForSelector("#admin .note");
  assert.match(await nb.p.textContent("#admin .note"), /관리자만/);
  await nb.ctx.close();
  if (process.env.ADMIN) {
    const ad = await ctxFor(A);
    await ad.p.goto(`${B}/me`);
    await ad.p.waitForSelector('a[href="/admin"]');
    await ad.p.goto(`${B}/admin`);
    await ad.p.waitForSelector(`[data-report="${t1}"]`);
    await ad.p.screenshot({ path: `${dir}/mobile-admin.png`, fullPage: true });
    await ad.p.click(`[data-report="${t1}"] button:text("되살리기")`);
    await ad.p.waitForFunction((id) => !document.querySelector(`[data-report="${id}"]`), t1);
    assert.equal(ok(await Bu.c.from("reports").select("trip_id").eq("trip_id", t1)).length, 0, "되살리기 후 신고가 남음");
    assert.deepEqual(ad.errs, []);
    await ad.ctx.close();
  }
} finally {
  await browser.close();
  await A.c.from("trips").delete().in("id", [t1, t2, mine]);
  if (copies.length) await Bu.c.from("trips").delete().in("id", copies);
  await A.c.storage.from("photos").remove(files);
}
console.log("OK");
