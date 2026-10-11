// D3 약관·개인정보·계정 삭제 점검: `npx vite preview --port 4173` 띄운 상태에서 `node d3.mjs` (실제 Supabase · 캡처는 shots/D3)
// 지울 계정 d3-e는 실행마다 새로 만든다 (점검이 지워버리므로). Supabase SQL에서 먼저:
//   with u as (insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
//     values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', 'd3-e@eodigaji.test', extensions.crypt('d3-test-pw-5', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"name":"d3-e"}', now(), now(), '', '', '', '') returning id, email)
//   insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
//     select gen_random_uuid(), id, id::text, 'email', jsonb_build_object('sub', id::text, 'email', email, 'email_verified', true), now(), now(), now() from u;
// e: 혼자 여행(사진 2장) + a와 같이 쓰는 여행(a도 기록) + a의 여행에 e 기록(사진 1장) → /me에서 [계정 삭제]
// → e 로그인 안 됨 · e 사진 3장 Storage에 없음 · 같이 쓰던 여행은 a가 owner로 남고 a 기록 그대로 · a 여행의 e 기록은 사라짐
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import assert from "node:assert";
import fs from "node:fs";
import { SB_URL, SB_KEY } from "./src/supabase.js";

const B = process.env.BASE || "http://localhost:4173", dir = "shots/D3";
fs.mkdirSync(dir, { recursive: true });
const signIn = (email, password) => createClient(SB_URL, SB_KEY, { auth: { persistSession: false } }).auth.signInWithPassword({ email, password });
const login = async (email, password) => {
  const c = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(email + ": " + error.message + " (d3-e면 머리말의 SQL로 다시 만들기)");
  return { c, session: data.session, uid: data.session.user.id };
};
const E = await login("d3-e@eodigaji.test", "d3-test-pw-5"), A = await login("a3-a@eodigaji.test", "a3-test-pw-1");
const hex = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
const ok = (r) => (assert.ifError(r.error), r.data);
await A.c.from("trips").delete().like("title", "D3 %"); // 지난 실패 실행이 남긴 것

// 만들기
const jpg = Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==", "base64");
async function post(u, trip, n) {
  const id = crypto.randomUUID(), photos = [];
  for (let i = 0; i < n; i++) { const p = `${u.uid}/${id}/${i}.jpg`; ok(await u.c.storage.from("photos").upload(p, jpg, { contentType: "image/jpeg" })); photos.push(p); }
  ok(await u.c.from("posts").insert({ id, trip_id: trip, prov: "강원", place: "강릉시", body: "D3 기록", photos }));
  return { id, photos };
}
const trip = async (u, title) => { const id = hex(); ok(await u.c.from("trips").insert({ id, owner_id: u.uid, prov: "강원", place: "강릉시", title, status: "done", done_on: "2026-10-01" })); return id; };
const join = async (owner, guest, tid) => { const token = hex(); ok(await owner.c.from("invites").insert({ token, trip_id: tid })); assert.equal(ok(await guest.c.rpc("accept_invite", { tok: token })), tid); };

const solo = await trip(E, "D3 혼자"), shared = await trip(E, "D3 같이"), aTrip = await trip(A, "D3 a의 여행");
await join(E, A, shared); await join(A, E, aTrip);
const p1 = await post(E, solo, 2), p2 = await post(A, shared, 0), p3 = await post(E, aTrip, 1);
const ePhotos = [...p1.photos, ...p3.photos];
// 지우기 전에 서명 URL을 받아둔다 (지운 뒤에 열리면 안 됨). 받아만 두고 열지 않음 → 캐시 없음
const signed = ok(await E.c.storage.from("photos").createSignedUrls(ePhotos, 600)).map((s) => s.signedUrl);
assert.equal(signed.length, 3);

// 약관·개인정보 페이지 + 로그인 화면 링크 (비로그인)
const browser = await chromium.launch();
const ctx0 = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const q = await ctx0.newPage(), errs = []; q.on("pageerror", (e) => errs.push(e.message));
for (const [path, h] of [["/terms", "이용약관"], ["/privacy", "개인정보 처리방침"]]) {
  await q.goto(B + path);
  await q.waitForSelector("#legal h2");
  assert.equal(await q.textContent("#legal h2"), h);
  assert.ok(await q.evaluate(() => document.documentElement.scrollWidth <= innerWidth), path + " 가로 넘침");
  await q.screenshot({ path: `${dir}/mobile-${path.slice(1)}.png`, fullPage: true });
}
await q.goto(B + "/login");
assert.equal(await q.getAttribute('#login a[href="/privacy"]', "href"), "/privacy");

// 화면에서 계정 삭제 (390)
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await ctx.addInitScript((s) => localStorage.setItem("sb-ltbhffozitpbsxjbnbnd-auth-token", JSON.stringify(s)), E.session);
const p = await ctx.newPage(); p.on("pageerror", (e) => errs.push(e.message));
p.on("dialog", (d) => d.accept());
await p.goto(B + "/me");
await p.waitForSelector("#bye summary");
await p.click("#bye summary");
await p.screenshot({ path: `${dir}/mobile-bye.png`, fullPage: true });
await p.click("#bye button");
await p.waitForURL(B + "/", { timeout: 20000 });
await p.waitForSelector(".who >> text=로그인");

// 확인
assert.match((await signIn("d3-e@eodigaji.test", "d3-test-pw-5")).error?.message ?? "", /invalid/i, "지운 계정으로 로그인됨");
for (const u of signed) assert.notEqual((await fetch(u)).status, 200, "지운 사진이 열림: " + u);
const t = ok(await A.c.from("trips").select("id, owner_id").eq("id", shared).single());
assert.equal(t.owner_id, A.uid, "같이 쓰던 여행이 a에게 안 넘어감");
assert.equal(ok(await A.c.from("trip_members").select("role").eq("trip_id", shared).eq("user_id", A.uid).single()).role, "owner");
assert.equal(ok(await A.c.from("posts").select("id").eq("id", p2.id)).length, 1, "a 기록이 사라짐");
assert.equal(ok(await A.c.from("posts").select("id").eq("id", p3.id)).length, 0, "a 여행에 e 기록이 남음");
assert.equal(ok(await A.c.from("trips").select("id").eq("id", solo)).length, 0);
assert.deepEqual(errs, []);

await A.c.from("trips").delete().in("id", [shared, aTrip]);
await browser.close();
console.log("D3 통과: 약관·개인정보 390 · 계정 삭제 → 로그인 불가 · 사진 3장 없음 · 같이 쓰던 여행 a에게 · a 기록 유지 · e 기록 삭제");
