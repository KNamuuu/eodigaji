// C1 다녀옴 + 사진 점검: `npx vite preview --port 4173` 띄운 상태에서 `node c1.mjs` (실제 Supabase, a3 테스트 계정 2개 · 캡처는 shots/C1)
// 3000×2000 JPEG 5장(EXIF + 가짜 GPS 표식)을 올리고 → 1600px 이하 · EXIF 없음 · 비공개는 남이 못 봄(글·사진 둘 다) 확인. 만든 trip·사진은 끝에 지운다
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SB_URL, SB_KEY } from "./src/supabase.js";

const B = process.env.BASE || "http://localhost:4173", dir = "shots/C1", tmp = fs.mkdtempSync(path.join(os.tmpdir(), "c1-"));
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
// Storage 권한 확인은 캐시를 피해서 (엣지가 같은 주소 응답을 사용자별로 캐시함 → 공개를 끈 직후에도 SDK download는 옛 응답을 줌)
const canGet = async (u, path) => (await fetch(`${SB_URL}/storage/v1/object/authenticated/photos/${path}?b=${Date.now()}`,
  { headers: { apikey: SB_KEY, ...(u && { Authorization: "Bearer " + u.session.access_token }) } })).ok;
const anon = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

const browser = await chromium.launch();
const open = async (session, width = 390) => {
  const ctx = await browser.newContext({ viewport: { width, height: width > 500 ? 800 : 844 }, deviceScaleFactor: 2 });
  if (session) await ctx.addInitScript((s) => localStorage.setItem("sb-ltbhffozitpbsxjbnbnd-auth-token", JSON.stringify(s)), session);
  const page = await ctx.newPage();
  page.errs = []; page.on("pageerror", (e) => page.errs.push(e.message));
  return page;
};

const id = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
{ const { error } = await A.c.from("trips").insert({ id, owner_id: A.session.user.id, prov: "강원", place: "강릉시", title: "C1 점검" }); assert.ifError(error); }

// 1. 큰 사진 5장 만들기: 캔버스 JPEG에 EXIF(APP1) 끼워 넣기 — 안에 GPS 표식 문자열
const a = await open(A.session);
const MARK = "GPS-37.7519N-128.8761E";
const app1 = (() => {
  const body = Buffer.concat([Buffer.from("Exif\0\0MM\0\x2a\0\0\0\x08\0\0\0\0\0\0", "latin1"), Buffer.from(MARK)]);
  const len = Buffer.alloc(2); len.writeUInt16BE(body.length + 2);
  return Buffer.concat([Buffer.from([0xff, 0xe1]), len, body]);
})();
await a.goto(B + "/plan/" + id); await a.waitForSelector("#done");
const files = [];
for (let i = 0; i < 5; i++) {
  const b64 = await a.evaluate((i) => {
    const c = Object.assign(document.createElement("canvas"), { width: i % 2 ? 2000 : 3000, height: i % 2 ? 3000 : 2000 });
    const g = c.getContext("2d");
    g.fillStyle = `hsl(${i * 70} 60% 60%)`; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = "#fff"; g.font = "bold 400px sans-serif"; g.fillText("C1 #" + (i + 1), 200, 1200);
    return c.toDataURL("image/jpeg", 0.9).split(",")[1];
  }, i);
  const jpg = Buffer.from(b64, "base64"), f = `${tmp}/photo-${i + 1}.jpg`;
  fs.writeFileSync(f, Buffer.concat([jpg.subarray(0, 2), app1, jpg.subarray(2)]));
  assert.ok(fs.readFileSync(f).includes(MARK));
  files.push(f);
}

// 2. 다녀왔어요 → 날짜 · 사진 5장 · 한 줄 · 비공개 → 저장
await a.screenshot({ path: `${dir}/mobile-1-plan.png`, fullPage: true });
await a.click("#done");
await a.fill('#recordForm [name="date"]', "2026-10-04");
await a.setInputFiles('#recordForm [name="photos"]', files);
await a.fill('#recordForm [name="body"]', "바다 보고 순두부 먹음");
assert.equal(await a.isChecked('#recordForm [name="public"]'), false); // 기본은 비공개
await a.screenshot({ path: `${dir}/mobile-2-form.png`, fullPage: true });
await a.click('#recordForm button:not([type="button"])');
await a.waitForFunction(() => document.querySelectorAll(".posts img").length === 5 && [...document.querySelectorAll(".posts img")].every((i) => i.complete && i.naturalWidth), null, { timeout: 30000 });
assert.match(await a.textContent(".record"), /다녀옴 · 2026-10-04/);
assert.match(await a.textContent(".posts"), /바다 보고 순두부 먹음.*비공개/);
await a.screenshot({ path: `${dir}/mobile-3-saved.png`, fullPage: true });

// 3. 올라간 파일: webp, 긴 변 1600 이하, EXIF 청크·GPS 표식 없음
const trip = (await A.c.from("trips").select("status, done_on").eq("id", id).single()).data;
assert.deepEqual(trip, { status: "done", done_on: "2026-10-04" });
const post = (await A.c.from("posts").select().eq("trip_id", id).single()).data;
assert.equal(post.photos.length, 5); assert.equal(post.is_public, false);
for (const p of post.photos) {
  const { data, error } = await A.c.storage.from("photos").download(p);
  assert.ifError(error);
  const buf = Buffer.from(await data.arrayBuffer());
  assert.equal(buf.toString("latin1", 0, 4) + buf.toString("latin1", 8, 12), "RIFFWEBP", p + " webp 아님");
  assert.ok(!buf.includes("EXIF") && !buf.includes("Exif") && !buf.includes(MARK), p + " EXIF 남음");
  assert.ok(buf.length < 1048576, p + " 1MB 넘음");
  const [w, h] = await a.evaluate(async (b64) => { const bmp = await createImageBitmap(await (await fetch("data:image/webp;base64," + b64)).blob()); return [bmp.width, bmp.height]; }, buf.toString("base64"));
  assert.equal(Math.max(w, h), 1600, `${p} ${w}×${h}`);
  console.log(p.split("/").slice(1).join("/"), `${w}×${h}`, Math.round(buf.length / 1024) + "KB");
}

// 4. 비공개 기록은 다른 계정·비로그인에서 안 보임 (글도 사진도)
assert.equal((await Bu.c.from("posts").select().eq("id", post.id)).data.length, 0);
assert.equal(await canGet(Bu, post.photos[0]), false, "남이 비공개 사진을 받음");
assert.equal((await anon.from("posts").select().eq("id", post.id)).data?.length ?? 0, 0);
assert.equal(await canGet(null, post.photos[0]), false);
await Bu.c.from("posts").update({ body: "침입" }).eq("id", post.id);
await Bu.c.storage.from("photos").remove([post.photos[0]]);
assert.equal(await canGet(A, post.photos[0]), true, "남이 사진을 지움");
assert.equal((await Bu.c.from("posts").insert({ trip_id: id, prov: "강원", place: "강릉시", body: "침입" })).error?.code, "42501"); // 멤버 아니면 못 씀

// 5. 공개로 바꾸면 다른 계정도 글·사진을 봄 (D1 준비) → 다시 비공개
await A.c.from("posts").update({ is_public: true }).eq("id", post.id);
assert.equal((await Bu.c.from("posts").select().eq("id", post.id)).data.length, 1);
assert.equal(await canGet(Bu, post.photos[0]), true, "공개 사진을 못 받음");
await A.c.from("posts").update({ is_public: false }).eq("id", post.id);
assert.equal(await canGet(Bu, post.photos[0]), false, "다시 비공개로 바꿨는데 사진이 보임");

// 6. PC 화면 + /me 목록에 다녀옴 표시
const pc = await open(A.session, 1280);
await pc.goto(B + "/plan/" + id);
await pc.waitForFunction(() => document.querySelectorAll(".posts img").length === 5 && [...document.querySelectorAll(".posts img")].every((i) => i.complete && i.naturalWidth), null, { timeout: 15000 });
await pc.screenshot({ path: `${dir}/pc-3-saved.png` });
await pc.goto(B + "/me"); await pc.waitForSelector(".trips a");
assert.match(await pc.textContent(`.trips a[href="/plan/${id}"]`), /다녀옴 2026-10-04/);
await pc.screenshot({ path: `${dir}/pc-4-me.png` });

for (const p of [a, pc]) assert.deepEqual(p.errs, []);
assert.ifError((await A.c.storage.from("photos").remove(post.photos)).error); // 정리
await A.c.from("trips").delete().eq("id", id);
assert.equal((await A.c.storage.from("photos").list(`${A.session.user.id}/${post.id}`)).data.length, 0);
await browser.close();
fs.rmSync(tmp, { recursive: true });
console.log("OK", id);
