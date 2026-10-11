// C2 내 지도 점검: `npx vite preview --port 4173` 띄운 상태에서 `node c2.mjs` (실제 Supabase, a3-a 테스트 계정 · 캡처는 shots/C2)
// 다녀온 곳 2개(강릉: 사진 있음, 서귀포: 없음) + 계획 중 1개 → 칠하기 · PC hover · 폰 첫 탭/두 번째 탭 · 키보드 포커스/Enter. 만든 것은 끝에 지운다
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import assert from "node:assert";
import fs from "node:fs";
import { SB_URL, SB_KEY } from "./src/supabase.js";

const B = process.env.BASE || "http://localhost:4173", dir = "shots/C2";
fs.mkdirSync(dir, { recursive: true });
const [email, password] = (process.env.A3_A || "a3-a@eodigaji.test:a3-test-pw-1").split(":");
const c = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
const { data: { session }, error } = await c.auth.signInWithPassword({ email, password });
assert.ifError(error);
const uid = session.user.id, regions = JSON.parse(fs.readFileSync("public/regions.json")).regions;
const ri = (prov, name) => regions.findIndex((r) => r.prov === prov && r.name === name);
const hex = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");

await c.from("trips").delete().like("title", "C2 %"); // 지난 실패 실행이 남긴 것
const T = [
  { id: hex(), owner_id: uid, prov: "강원", place: "강릉시", title: "C2 강릉", status: "done", done_on: "2026-09-20" },
  { id: hex(), owner_id: uid, prov: "제주", place: "서귀포시", title: "C2 서귀포", status: "done", done_on: "2026-08-02" },
  { id: hex(), owner_id: uid, prov: "전북", place: "전주시", title: "C2 전주 계획", status: "planned", done_on: null },
];
assert.ifError((await c.from("trips").insert(T)).error);
const gn = ri("강원", "강릉시"), sg = ri("제주", "서귀포시"), jj = ri("전북", "전주시");

const browser = await chromium.launch();
const open = async (width, mobile) => {
  const ctx = await browser.newContext({ viewport: { width, height: mobile ? 844 : 800 }, deviceScaleFactor: 2, hasTouch: mobile, isMobile: mobile });
  await ctx.addInitScript((s) => localStorage.setItem("sb-ltbhffozitpbsxjbnbnd-auth-token", JSON.stringify(s)), session);
  const page = await ctx.newPage();
  page.errs = []; page.on("pageerror", (e) => page.errs.push(e.message));
  return page;
};

// 강릉 기록 + 사진 1장 (페이지 캔버스로 만든 jpeg)
const post = hex().replace(/(.{8})(.{4})(.{4})(.{4})/, "$1-$2-$3-$4-"), pic = `${uid}/${post}/0.jpg`;
{
  const p = await open(390, false); await p.goto(B + "/");
  const b64 = await p.evaluate(() => {
    const k = Object.assign(document.createElement("canvas"), { width: 800, height: 600 }), g = k.getContext("2d");
    g.fillStyle = "hsl(200 60% 55%)"; g.fillRect(0, 0, 800, 600); g.fillStyle = "#fff"; g.font = "bold 120px sans-serif"; g.fillText("강릉 바다", 120, 340);
    return k.toDataURL("image/jpeg", 0.85).split(",")[1];
  });
  assert.ifError((await c.storage.from("photos").upload(pic, Buffer.from(b64, "base64"), { contentType: "image/jpeg" })).error);
  assert.ifError((await c.from("posts").insert({ id: post, trip_id: T[0].id, prov: "강원", place: "강릉시", body: "C2", photos: [pic] })).error);
  await p.context().close();
}

// 지역 path 안에 확실히 들어가는 화면 좌표 (경계 근처는 옆 지역이 잡힐 수 있어서)
const pointIn = (page, i) => page.evaluate((i) => {
  const el = document.querySelectorAll("#regions path")[i], b = el.getBoundingClientRect();
  for (let s = .5; s > .01; s /= 2) for (let fy = s; fy < 1; fy += s) for (let fx = s; fx < 1; fx += s) {
    const x = b.left + b.width * fx, yy = b.top + b.height * fy;
    if (document.elementFromPoint(x, yy) === el) return [x, yy];
  }
  return null;
}, i);
const status = (page) => page.textContent("#status");
const ready = (page) => page.waitForFunction((n) => document.querySelectorAll("#regions path.visited").length === n, 2, { timeout: 15000 }).catch(async () => {
  throw new Error("칠한 곳 수 다름: " + await page.evaluate(() => document.querySelectorAll("#regions path.visited").length)); });
const cls = (page, i) => page.evaluate((i) => document.querySelectorAll("#regions path")[i].getAttribute("class"), i);

for (const [width, mobile, tag] of [[1280, false, "pc"], [390, true, "mobile"]]) {
  const p = await open(width, mobile);
  await p.goto(B + "/me"); await ready(p);
  // 계정에 다른 다녀온 곳이 없어야 2곳 (테스트 계정이라 정리돼 있음)
  assert.equal(await cls(p, gn), "visited"); assert.equal(await cls(p, sg), "visited"); assert.equal(await cls(p, jj), null); // 계획 중은 안 칠함
  assert.match(await status(p), /167곳 중 2곳/);
  await p.screenshot({ path: `${dir}/${tag}-1-map.png`, fullPage: mobile });

  const [x, y] = await pointIn(p, gn);
  if (mobile) {
    await p.touchscreen.tap(x, y);
    await p.waitForFunction(() => /강릉시/.test(document.querySelector("#status").textContent));
    assert.match(p.url(), /\/me$/, "첫 탭에 이동해버림");
  } else {
    await p.mouse.move(x, y);
    await p.waitForFunction(() => /강릉시/.test(document.querySelector("#status").textContent));
  }
  assert.match(await status(p), /강릉시강원 · 다녀옴 2026-09-20/);
  await p.waitForFunction(() => { const i = document.querySelector("#status img"); return i?.complete && i.naturalWidth > 0; }, null, { timeout: 15000 });
  await p.screenshot({ path: `${dir}/${tag}-2-peek.png`, fullPage: mobile });

  if (!mobile) { // 마우스 빼면 닫힘, 사진 없는 곳은 사진 없이
    await p.mouse.move(5, 790); assert.match(await status(p), /167곳 중 2곳/);
    const [sx, sy] = await pointIn(p, sg); await p.mouse.move(sx, sy);
    assert.match(await status(p), /서귀포시제주 · 다녀옴 2026-08-02/); assert.equal(await p.$("#status img"), null);
    await p.mouse.move(x, y);
  }
  mobile ? await p.touchscreen.tap(x, y) : await p.mouse.click(x, y);
  await p.waitForURL(B + "/region/" + regions[gn].id);
  await p.waitForSelector(`.trips a[href="/plan/${T[0].id}"]`);
  await p.screenshot({ path: `${dir}/${tag}-3-region.png`, fullPage: mobile });
  assert.deepEqual(p.errs, []);
  await p.context().close();
}

// 키보드: Tab으로 칠한 곳에 포커스 → 카드, Enter → 지역 피드
{
  const p = await open(1280, false);
  await p.goto(B + "/me"); await ready(p);
  let hit = false;
  for (let k = 0; k < 30 && !hit; k++) { await p.keyboard.press("Tab"); hit = await p.evaluate(() => document.activeElement?.matches("#regions path[tabindex]")); }
  assert.ok(hit, "Tab으로 칠한 곳에 못 감");
  const name = await p.evaluate(() => document.activeElement.getAttribute("aria-label"));
  assert.match(await status(p), new RegExp(name.split(" ")[1]));
  await p.screenshot({ path: `${dir}/pc-4-keyboard.png` });
  await p.keyboard.press("Enter");
  await p.waitForURL(/\/region\/\d+$/);
  assert.deepEqual(p.errs, []);
  console.log("키보드 포커스:", name);
}

await browser.close();
assert.ifError((await c.storage.from("photos").remove([pic])).error);
assert.ifError((await c.from("trips").delete().in("id", T.map((t) => t.id))).error);
console.log("OK");
