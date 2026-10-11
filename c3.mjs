// C3 지역 피드 점검: `npx vite preview --port 4173` 띄운 상태에서 `node c3.mjs` (실제 Supabase, a3 테스트 계정 2개 · 캡처는 shots/C3)
// 강릉 다녀옴 + 내 기록(사진 2장) + 남(b)의 공개 기록 → /me에서 강릉 눌러 들어옴 · 지도 확대 · 내 것만 · 사진 크게 · 수정 · 삭제(사진까지). 만든 것은 끝에 지운다
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import assert from "node:assert";
import fs from "node:fs";
import { SB_URL, SB_KEY } from "./src/supabase.js";

const B = process.env.BASE || "http://localhost:4173", dir = "shots/C3";
fs.mkdirSync(dir, { recursive: true });
const login = async (cred) => {
  const [email, password] = cred.split(":");
  const c = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return { c, session: data.session, uid: data.session.user.id };
};
const A = await login(process.env.A3_A || "a3-a@eodigaji.test:a3-test-pw-1");
const Bu = await login(process.env.A3_B || "a3-b@eodigaji.test:a3-test-pw-2");
const regions = JSON.parse(fs.readFileSync("public/regions.json")).regions;
const gn = regions.findIndex((r) => r.prov === "강원" && r.name === "강릉시");
const hex = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
for (const u of [A, Bu]) await u.c.from("trips").delete().like("title", "C3 %"); // 지난 실패 실행이 남긴 것

const browser = await chromium.launch();
const open = async (width, mobile) => {
  const ctx = await browser.newContext({ viewport: { width, height: mobile ? 844 : 800 }, deviceScaleFactor: 2, hasTouch: mobile, isMobile: mobile });
  await ctx.addInitScript((s) => localStorage.setItem("sb-ltbhffozitpbsxjbnbnd-auth-token", JSON.stringify(s)), A.session);
  const page = await ctx.newPage();
  page.errs = []; page.on("pageerror", (e) => page.errs.push(e.message));
  page.on("dialog", (d) => d.accept()); // 삭제 확인
  return page;
};
const jpeg = (p, text, hue) => p.evaluate(([text, hue]) => {
  const k = Object.assign(document.createElement("canvas"), { width: 800, height: 600 }), g = k.getContext("2d");
  g.fillStyle = `hsl(${hue} 55% 55%)`; g.fillRect(0, 0, 800, 600); g.fillStyle = "#fff"; g.font = "bold 110px sans-serif"; g.fillText(text, 100, 340);
  return k.toDataURL("image/jpeg", 0.85).split(",")[1];
}, [text, hue]);
// u의 강릉 다녀옴 trip + 기록 1개 (사진 n장)
async function seed(u, p, { body, n, pub }) {
  const trip = hex(), post = crypto.randomUUID(), photos = [];
  assert.ifError((await u.c.from("trips").insert({ id: trip, owner_id: u.uid, prov: "강원", place: "강릉시", title: "C3 강릉", status: "done", done_on: "2026-09-20" })).error);
  for (let i = 0; i < n; i++) {
    const path = `${u.uid}/${post}/${i}.jpg`;
    assert.ifError((await u.c.storage.from("photos").upload(path, Buffer.from(await jpeg(p, ["경포 바다", "초당 순두부"][i], [200, 30][i]), "base64"), { contentType: "image/jpeg" })).error);
    photos.push(path);
  }
  assert.ifError((await u.c.from("posts").insert({ id: post, trip_id: trip, prov: "강원", place: "강릉시", body, photos, is_public: pub })).error);
  return { trip, post, photos };
}
const pointIn = (page, i) => page.evaluate((i) => {
  const el = document.querySelectorAll("#regions path")[i], b = el.getBoundingClientRect();
  for (let s = .5; s > .01; s /= 2) for (let fy = s; fy < 1; fy += s) for (let fx = s; fx < 1; fx += s) {
    const x = b.left + b.width * fx, y = b.top + b.height * fy;
    if (document.elementFromPoint(x, y) === el) return [x, y];
  }
}, i);

for (const [width, mobile, tag] of [[1280, false, "pc"], [390, true, "mobile"]]) {
  const p = await open(width, mobile);
  await p.goto(B + "/");
  const mine = await seed(A, p, { body: "C3 바다 보고 순두부", n: 2, pub: false });
  const other = await seed(Bu, p, { body: "C3 남의 공개 기록", n: 0, pub: true });

  // 1. 내 지도에서 강릉 → 지역 피드 (PC 클릭 / 폰 두 번 탭)
  await p.goto(B + "/me");
  await p.waitForFunction((i) => document.querySelectorAll("#regions path")[i]?.classList.contains("visited"), gn, { timeout: 15000 });
  const [x, y] = await pointIn(p, gn);
  const peeked = () => p.waitForFunction(() => /강릉시/.test(document.querySelector("#status").textContent));
  if (mobile) { await p.touchscreen.tap(x, y); await peeked(); await p.touchscreen.tap(x, y); }
  else { await p.mouse.move(x, y); await peeked(); await p.mouse.click(x, y); }
  await p.waitForURL(B + "/region/" + regions[gn].id);

  // 2. 지도 확대 + 내 기록만 (남의 공개 기록은 D1 "모두의 후기"에서)
  const li = `li[data-post="${mine.post}"]`;
  await p.waitForFunction((s) => [...document.querySelectorAll(s + " img")].filter((i) => i.complete && i.naturalWidth).length === 2, li, { timeout: 15000 });
  const vb = (await p.getAttribute("#map", "viewBox")).split(" ").map(Number);
  assert.ok(vb[2] < 150, "지도가 확대 안 됨: " + vb);
  assert.match(await p.textContent(li), /C3 바다 보고 순두부/);
  assert.match(await p.textContent(li), /2026-09-20 · 비공개/);
  assert.equal(await p.$(`li[data-post="${other.post}"]`), null, "남의 기록이 내 기록에 섞임");
  assert.match(await p.textContent("#status"), /기록 1개/);
  await p.screenshot({ path: `${dir}/${tag}-1-feed.png`, fullPage: mobile });

  // 3. 사진 크게 → 누르면 닫힘
  await p.click(`${li} .photos button >> nth=1`);
  await p.waitForFunction(() => { const i = document.querySelector("dialog.big[open] img"); return i?.complete && i.naturalWidth > 0; });
  const box = await p.locator("dialog.big img").boundingBox();
  assert.ok(box.width > width * 0.8 || box.height > 600, "크게 안 보임: " + JSON.stringify(box));
  await p.screenshot({ path: `${dir}/${tag}-2-big.png` });
  await p.click("dialog.big");
  await p.waitForFunction(() => !document.querySelector("dialog.big[open]"));

  // 4. 수정: 한 줄 + 공개
  await p.click(`${li} .acts button:text("수정")`);
  await p.fill(`${li} .edit input[aria-label="한 줄"]`, "C3 고친 한 줄");
  await p.check(`${li} .edit input[type=checkbox]`);
  await p.screenshot({ path: `${dir}/${tag}-3-edit.png`, fullPage: mobile });
  await p.click(`${li} .edit button:text("저장")`);
  await p.waitForFunction((s) => /C3 고친 한 줄/.test(document.querySelector(s)?.textContent) && /공개/.test(document.querySelector(s + " small").textContent), li);
  const { data: row } = await A.c.from("posts").select("body, is_public").eq("id", mine.post).single();
  assert.deepEqual(row, { body: "C3 고친 한 줄", is_public: true });
  await p.screenshot({ path: `${dir}/${tag}-4-edited.png`, fullPage: mobile });

  // 5. 삭제: 행 + 사진 둘 다
  await p.click(`${li} .acts button:text("삭제")`);
  await p.waitForSelector(li, { state: "detached" });
  await p.waitForSelector("text=아직 이 지역 기록이 없어요");
  assert.equal((await A.c.from("posts").select("id").eq("id", mine.post)).data.length, 0);
  const { data: left } = await A.c.storage.from("photos").list(`${A.uid}/${mine.post}`);
  assert.equal(left.length, 0, "사진이 남음");
  await p.screenshot({ path: `${dir}/${tag}-5-deleted.png`, fullPage: mobile });

  assert.deepEqual(p.errs, []);
  await p.context().close();
  assert.ifError((await A.c.from("trips").delete().eq("id", mine.trip)).error);
  assert.ifError((await Bu.c.from("trips").delete().eq("id", other.trip)).error);
  console.log(tag, "OK");
}
await browser.close();
console.log("OK");
