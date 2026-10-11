// D2 정복 지도 카드 점검: `npx vite preview --port 4173` 띄운 상태에서 `node d2.mjs` (실제 Supabase, a3-a 테스트 계정 · 캡처는 shots/D2)
// 서울·제주 2곳(둘 다 완주) + 강릉 다녀옴 → /me 카드: 1080×1350 PNG, 칠한 곳 색, 저장 다운로드, Web Share(가짜)로 파일 공유. 만든 것은 끝에 지운다
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import assert from "node:assert";
import fs from "node:fs";
import { SB_URL, SB_KEY } from "./src/supabase.js";

const B = process.env.BASE || "http://localhost:4173", dir = "shots/D2";
fs.mkdirSync(dir, { recursive: true });
const [email, password] = (process.env.A3_A || "a3-a@eodigaji.test:a3-test-pw-1").split(":");
const c = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
const { data: { session }, error } = await c.auth.signInWithPassword({ email, password });
assert.ifError(error);
const uid = session.user.id, hex = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
await c.from("trips").delete().like("title", "D2 %");
const T = [["서울", "서울"], ["제주", "제주시"], ["제주", "서귀포시"], ["강원", "강릉시"]]
  .map(([prov, place]) => ({ id: hex(), owner_id: uid, prov, place, title: "D2 " + place, status: "done", done_on: "2026-10-01" }));
assert.ifError((await c.from("trips").insert(T)).error);

const browser = await chromium.launch();
try {
  for (const [width, mobile, tag] of [[390, true, "mobile"], [1280, false, "pc"]]) {
    const ctx = await browser.newContext({ viewport: { width, height: mobile ? 844 : 800 }, deviceScaleFactor: 2, hasTouch: mobile, isMobile: mobile, acceptDownloads: true });
    await ctx.addInitScript((s) => localStorage.setItem("sb-ltbhffozitpbsxjbnbnd-auth-token", JSON.stringify(s)), session);
    if (mobile) await ctx.addInitScript(() => { // 폰 Web Share 흉내: 넘긴 파일을 기록
      navigator.canShare = (d) => d.files?.every((f) => f.type === "image/png");
      navigator.share = async (d) => { window.shared = { n: d.files.length, type: d.files[0].type, size: d.files[0].size }; };
    });
    const p = await ctx.newPage(), errs = [];
    p.on("pageerror", (e) => errs.push(e.message));
    await p.goto(B + "/me");
    await p.waitForFunction(() => document.querySelector("#card img")?.naturalWidth > 0);

    // 이미지: 크기 · 칠한 곳(서울)과 안 칠한 곳(부산 중구) 색이 다름 · 390에서 넘치지 않음
    const r = await p.evaluate(async () => {
      const img = document.querySelector("#card img"), regs = (await (await fetch("/regions.json")).json());
      const cv = Object.assign(document.createElement("canvas"), { width: img.naturalWidth, height: img.naturalHeight }), g = cv.getContext("2d");
      g.drawImage(img, 0, 0);
      const s = Math.min(552 / regs.w, 924 / regs.h), ox = 48 + (600 - regs.w * s) / 2, oy = 330 + (1020 - 48 - regs.h * s) / 2;
      const px = (prov, name) => { const q = regs.regions.find((x) => x.prov === prov && x.name === name); return [...g.getImageData(ox + q.cx * s, oy + q.cy * s, 1, 1).data].join(); };
      return { w: img.naturalWidth, h: img.naturalHeight, shown: img.getBoundingClientRect().width, seoul: px("서울", "서울"), jeju: px("제주", "제주시"), busan: px("부산", "부산"), bg: [...g.getImageData(5, 5, 1, 1).data].join(), scroll: document.documentElement.scrollWidth };
    });
    assert.deepEqual([r.w, r.h], [1080, 1350]);
    assert.equal(r.seoul, r.jeju, "칠한 두 곳 색이 다름");
    assert.notEqual(r.seoul, r.busan, "칠한 곳·안 칠한 곳 색이 같음");
    assert.ok(r.shown <= width - 32 && r.scroll <= width, "카드가 화면을 넘침");

    // 저장: PNG 다운로드 (IHDR 1080×1350)
    const [dl] = await Promise.all([p.waitForEvent("download"), p.click("#card a")]);
    const png = fs.readFileSync(await dl.path());
    assert.equal(png.toString("ascii", 1, 4), "PNG");
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [1080, 1350]);
    fs.writeFileSync(`${dir}/card-${tag}.png`, png);

    // 공유: Web Share 있으면 [공유하기] → 파일 1장, 없으면 버튼 없음
    if (mobile) {
      await p.click('#card button:text("공유하기")');
      assert.deepEqual(await p.evaluate(() => ({ n: shared.n, type: shared.type })), { n: 1, type: "image/png" });
    } else assert.equal(await p.$('#card button'), null, "Web Share 없는데 공유 버튼이 보임");

    await p.locator("#card").scrollIntoViewIfNeeded();
    await p.screenshot({ path: `${dir}/${tag}-me.png`, fullPage: mobile });
    assert.deepEqual(errs, []);
    await ctx.close();
    console.log(tag, "OK", r.busan, r.seoul);
  }
} finally {
  await browser.close();
  await c.from("trips").delete().in("id", T.map((t) => t.id));
}
console.log("OK");
