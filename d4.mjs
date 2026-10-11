// D4 사진 지도 점검: `npx vite preview --port 4173` 띄운 상태에서 `node d4.mjs` (실제 Supabase, a3-a 테스트 계정 · 캡처는 shots/D4)
// 서울: 앱 [+ 기록 남기기]로 빨강·초록 사진 2장 (썸네일 같이 올라감) · 제주시: 옛 방식(원본만) 파랑 1장 → /me가 썸네일을 만들어 올림
// 390px: 사진이 지역 모양대로 · 다시 열면 썸네일만 받음 · 핀치 확대 → 탭 미리보기 → 두 번째 탭 이동 · 드래그 이동 · [전체 보기]
// 지역 화면에서 초록을 [대표사진으로] → 지도·카드가 초록. 만든 것은 끝에 지운다
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import assert from "node:assert";
import fs from "node:fs";
import { SB_URL, SB_KEY } from "./src/supabase.js";

const B = process.env.BASE || "http://localhost:4173", dir = "shots/D4";
fs.mkdirSync(dir, { recursive: true });
const [email, password] = (process.env.A3_A || "a3-a@eodigaji.test:a3-test-pw-1").split(":");
const c = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
const { data: { session }, error } = await c.auth.signInWithPassword({ email, password });
assert.ifError(error);
const uid = session.user.id, hex = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
const ok = (r) => (assert.ifError(r.error), r.data);
await c.from("trips").delete().like("title", "D4 %");
const T = [["서울", "서울"], ["제주", "제주시"]].map(([prov, place]) => ({ id: hex(), owner_id: uid, prov, place, title: "D4 " + place, status: "done", done_on: "2026-10-01" }));
ok(await c.from("trips").insert(T));
const files = [];

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await ctx.addInitScript((s) => localStorage.setItem("sb-ltbhffozitpbsxjbnbnd-auth-token", JSON.stringify(s)), session);
  const p = await ctx.newPage(), errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(B + "/terms");

  // 단색 + 줄무늬 JPEG 1200×900 (사진처럼 큼직하게)
  const jpg = async (color) => Buffer.from((await p.evaluate((color) => {
    const cv = Object.assign(document.createElement("canvas"), { width: 1200, height: 900 }), g = cv.getContext("2d");
    g.fillStyle = color; g.fillRect(0, 0, 1200, 900); g.fillStyle = "rgba(255,255,255,.25)";
    for (let x = 0; x < 1200; x += 120) g.fillRect(x, 0, 30, 900);
    return cv.toDataURL("image/jpeg", 0.9);
  }, color)).split(",")[1], "base64");
  const [red, green, blue] = [await jpg("rgb(220,40,40)"), await jpg("rgb(40,170,60)"), await jpg("rgb(40,80,220)")];

  // 제주시: 옛 방식 (원본만, 썸네일 없음)
  const old = crypto.randomUUID(), oldPath = `${uid}/${old}/0.jpg`;
  ok(await c.storage.from("photos").upload(oldPath, blue, { contentType: "image/jpeg" })); files.push(oldPath, oldPath.replace("/0.", "/t0."));
  ok(await c.from("posts").insert({ id: old, trip_id: T[1].id, prov: "제주", place: "제주시", body: "D4 옛 사진", photos: [oldPath] }));

  // 서울: 앱으로 사진 2장 → 원본 + 썸네일 4개
  await p.goto(B + "/plan/" + T[0].id);
  await p.click("#done");
  await p.setInputFiles('#recordForm input[type="file"]', [{ name: "r.jpg", mimeType: "image/jpeg", buffer: red }, { name: "g.jpg", mimeType: "image/jpeg", buffer: green }]);
  await p.fill('#recordForm input[name="body"]', "D4 서울");
  await p.click("#recordForm .btn:not(.sub)");
  await p.waitForSelector(".posts .photos img");
  const seoulPost = ok(await c.from("posts").select("id, photos").eq("trip_id", T[0].id).single());
  assert.equal(seoulPost.photos.length, 2, "posts.photos엔 원본만");
  const listed = ok(await c.storage.from("photos").list(`${uid}/${seoulPost.id}`)).map((f) => f.name).sort();
  assert.deepEqual(listed.map((n) => n.replace(/\.\w+$/, "")), ["0", "1", "t0", "t1"]);
  files.push(...listed.map((n) => `${uid}/${seoulPost.id}/${n}`));

  // /me 첫 방문: 제주 썸네일을 만들어 올린다
  const imgs = () => p.evaluate(() => [...document.querySelectorAll("#photos image")].map((im) => im.getAttribute("href")));
  await p.goto(B + "/me");
  await p.waitForFunction(() => document.querySelectorAll("#photos image").length === 2);
  await p.waitForFunction(() => [...document.querySelectorAll("#photos image")].every((im) => im.getBBox().width > 0));
  for (let i = 0; i < 20 && !ok(await c.storage.from("photos").list(`${uid}/${old}`)).some((f) => f.name === "t0.jpg"); i++) await p.waitForTimeout(300);
  assert.ok(ok(await c.storage.from("photos").list(`${uid}/${old}`)).some((f) => f.name.startsWith("t0.")), "옛 사진 썸네일이 안 만들어짐");

  // 다시 열면: 사진 받는 요청은 썸네일(t숫자)뿐
  const got = [];
  p.on("request", (r) => r.url().includes("/storage/v1/object/sign/photos/") && got.push(decodeURIComponent(new URL(r.url()).pathname)));
  await p.reload();
  await p.waitForFunction(() => [...document.querySelectorAll("#photos image")].length === 2);
  await p.waitForLoadState("networkidle");
  assert.equal(new Set(got).size, 2, "사진 요청: " + got.join()); // 지도·카드가 같은 썸네일을 한 번씩
  assert.ok(got.every((u) => /\/t\d+\.\w+$/.test(u)), "원본을 받음: " + got.join());
  assert.ok((await imgs()).some((h) => h.includes("/t0.")), "기본 대표사진은 첫 사진");
  await p.screenshot({ path: `${dir}/mobile-me.png` });

  // 핀치 확대 (서울 중심, 손가락 사이 60 → 300px)
  const cdp = await ctx.newCDPSession(p);
  const at = (prov, name) => p.evaluate(async ([prov, name]) => {
    const r = (await (await fetch("/regions.json")).json()).regions.find((x) => x.prov === prov && x.name === name), svg = document.querySelector("#map");
    const pt = new DOMPoint(r.cx, r.cy).matrixTransform(svg.getScreenCTM());
    return [pt.x, pt.y];
  }, [prov, name]);
  const touch = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
  const [sx, sy] = await at("서울", "서울");
  await touch("touchStart", [[sx - 30, sy], [sx + 30, sy]]);
  for (let k = 1; k <= 10; k++) await touch("touchMove", [[sx - 30 - 12 * k, sy], [sx + 30 + 12 * k, sy]]);
  await touch("touchEnd", []);
  const vb = () => p.evaluate(() => document.querySelector("#map").getAttribute("viewBox").split(" ").map(Number));
  const v1 = await vb();
  assert.ok(v1[2] < 100, "확대 안 됨: " + v1);
  assert.ok(await p.isVisible("#fit"), "[전체 보기] 없음");
  assert.equal(new URL(p.url()).pathname, "/me", "핀치가 탭으로 처리됨");
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${dir}/mobile-pinch-seoul.png` });

  // 확대 중 탭: 첫 탭 미리보기, 두 번째 탭 이동
  const [tx, ty] = await at("서울", "서울");
  await p.touchscreen.tap(tx, ty);
  await p.waitForFunction(() => document.querySelector("#status").textContent.startsWith("서울"));
  assert.equal(new URL(p.url()).pathname, "/me");
  await p.screenshot({ path: `${dir}/mobile-pinch-peek.png` });

  // 드래그(한 손가락)는 이동만, 미리보기·이동 안 일어남
  await touch("touchStart", [[tx, ty]]);
  for (let k = 1; k <= 8; k++) await touch("touchMove", [[tx - 15 * k, ty + 5 * k]]);
  await touch("touchEnd", []);
  const v2 = await vb();
  assert.ok(v2[0] > v1[0], "드래그 이동 안 됨");
  assert.equal(new URL(p.url()).pathname, "/me", "드래그가 탭으로 처리됨");
  const [tx2, ty2] = await at("서울", "서울");
  await p.touchscreen.tap(tx2, ty2);
  await p.waitForURL(/\/region\/\d+$/);

  // 지역 화면: 초록(두 번째)을 대표사진으로
  await p.click(".posts .photos button >> nth=1");
  await p.click(".big .cover");
  await p.waitForSelector(".big .cover:disabled");
  assert.equal(ok(await c.from("trips").select("cover").eq("id", T[0].id).single()).cover, seoulPost.photos[1]);
  await p.screenshot({ path: `${dir}/mobile-cover.png` });

  // /me: 서울이 초록 썸네일 · [전체 보기] · 카드에도 사진
  await p.goto(B + "/me");
  await p.waitForFunction(() => [...document.querySelectorAll("#photos image")].some((im) => im.getAttribute("href").includes("/t1.")));
  const card = async () => p.evaluate(async () => {
    const img = document.querySelector("#card img"), regs = await (await fetch("/regions.json")).json();
    const cv = Object.assign(document.createElement("canvas"), { width: img.naturalWidth, height: img.naturalHeight }), g = cv.getContext("2d");
    g.drawImage(img, 0, 0);
    const s = Math.min(552 / regs.w, 924 / regs.h), ox = 48 + (600 - regs.w * s) / 2, oy = 330 + (1020 - 48 - regs.h * s) / 2;
    const px = (prov, name) => { const q = regs.regions.find((x) => x.prov === prov && x.name === name); return [...g.getImageData(ox + q.cx * s, oy + q.cy * s, 1, 1).data]; };
    return { seoul: px("서울", "서울"), jeju: px("제주", "제주시") };
  });
  await p.waitForFunction(() => document.querySelector("#card img")?.naturalWidth > 0);
  let px;
  for (let i = 0; i < 20; i++) { px = await card(); if (px.seoul[1] > px.seoul[0] + 50) break; await p.waitForTimeout(300); } // 사진 받은 뒤 다시 그림
  assert.ok(px.seoul[1] > px.seoul[0] + 50 && px.seoul[1] > px.seoul[2] + 50, "카드 서울이 초록 아님: " + px.seoul);
  assert.ok(px.jeju[2] > px.jeju[0] + 50, "카드 제주가 파랑 아님: " + px.jeju);
  fs.writeFileSync(`${dir}/card.png`, Buffer.from((await p.evaluate(async () => { const b = await (await fetch(document.querySelector("#card img").src)).blob(); return [...new Uint8Array(await b.arrayBuffer())]; }))));

  const [jx, jy] = await at("제주", "제주시");
  await touch("touchStart", [[jx - 20, jy], [jx + 20, jy]]);
  for (let k = 1; k <= 10; k++) await touch("touchMove", [[jx - 20 - 10 * k, jy], [jx + 20 + 10 * k, jy]]);
  await touch("touchEnd", []);
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${dir}/mobile-pinch-jeju.png` });
  await p.click("#fit");
  assert.deepEqual(await vb(), [0, 0, 400, (await vb())[3]]);
  assert.ok(!(await p.isVisible("#fit")));
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "가로 넘침");
  assert.deepEqual(errs, []);
  await ctx.close();

  // PC: 휠 확대
  const pc = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await pc.addInitScript((s) => localStorage.setItem("sb-ltbhffozitpbsxjbnbnd-auth-token", JSON.stringify(s)), session);
  const q = await pc.newPage();
  await q.goto(B + "/me");
  await q.waitForFunction(() => document.querySelectorAll("#photos image").length === 2);
  const box = await q.locator("#map").boundingBox();
  await q.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 5; i++) await q.mouse.wheel(0, -200);
  assert.ok((await q.evaluate(() => +document.querySelector("#map").getAttribute("viewBox").split(" ")[2])) < 400, "휠 확대 안 됨");
  await q.waitForTimeout(300);
  await q.screenshot({ path: `${dir}/pc-wheel.png` });
  await pc.close();
} finally {
  await browser.close();
  await c.from("trips").delete().in("id", T.map((t) => t.id));
  await c.storage.from("photos").remove(files);
}
console.log("OK");
