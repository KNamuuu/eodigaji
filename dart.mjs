// B1 다트 점검: 서버 띄운 상태에서 `node dart.mjs` (BASE=http://localhost:3000)
// 바람 0으로 맞춘 뒤 목표 지점까지 필요한 힘을 계산해 던진다 (손 떨림은 그대로) → 제주·울릉·서울 각각 10번 안에 맞혀야 통과
import { chromium } from "playwright";
import assert from "node:assert";
import fs from "node:fs";

const BASE = process.env.BASE || "http://localhost:3000";
const dir = "shots/B1";
fs.mkdirSync(dir, { recursive: true });
const browser = await chromium.launch();

for (const [tag, width, height] of [["mobile", 390, 844], ["pc", 1280, 800]]) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
  await page.addInitScript(() => {
    let s = 7;
    window.seeded = () => { Math.random = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32; };
    window.noWind = () => { Math.random = () => 0; }; // 다음 newWind()의 풍속 = 0
    window.seeded();
  });
  await page.goto(BASE);
  await page.waitForSelector("#regions path");
  await page.click("[data-mode=dart]");
  await page.waitForSelector("#dart");

  // 화면 좌표 ↔ SVG 좌표
  const toScreen = (x, y) => page.evaluate(([x, y]) => {
    const svg = document.querySelector("#map"), pt = svg.createSVGPoint(); pt.x = x; pt.y = y;
    const p = pt.matrixTransform(svg.getScreenCTM()); return [p.x, p.y];
  }, [x, y]);
  const h = await page.evaluate(() => fetch("/regions.json").then((r) => r.json()).then((d) => d.h));
  const REST = [200, h + 46], FAR = REST[1] - 10, MAX = 130;

  async function pull(from, to, { release = true, shotName } = {}) {
    const a = await toScreen(...from), b = await toScreen(...to);
    await page.mouse.move(...a); await page.mouse.down();
    await page.mouse.move(...b, { steps: 8 });
    if (shotName) await page.screenshot({ path: `${dir}/${tag}-${shotName}.png` });
    if (release) await page.mouse.up();
  }

  // 1) 손가락이 화면 밖으로 → pointercancel: 조준선·링이 남으면 안 됨
  await pull([REST[0], REST[1] + 10], [REST[0] + 15, REST[1] + 70], { release: false, shotName: "1-aiming" });
  assert.equal(await page.isVisible("#aim"), true);
  await page.evaluate(() => document.querySelector("#map").dispatchEvent(new PointerEvent("pointercancel", { pointerId: 1, bubbles: true })));
  for (const sel of ["#aim", "#target", "#ring", "#band"]) assert.equal(await page.isHidden(sel), true, sel + " 남음");
  await page.mouse.up();

  // 2) 목표 맞히기
  const targets = { 제주시: 0, 울릉군: 0, 서울: 0 };
  for (const name of Object.keys(targets)) {
    const r = await page.evaluate((n) => fetch("/regions.json").then((r) => r.json()).then((d) => d.regions.find((r) => r.name === n)), name);
    for (let i = 1; i <= 10; i++) {
      await page.evaluate(() => window.noWind());
      await page.click("[data-mode=dart]"); // 다트 새로 = 바람 새로(0)
      await page.waitForSelector("#dart");
      await page.evaluate(() => window.seeded());
      const dx = r.cx - REST[0], dy = r.cy - REST[1], d = Math.hypot(dx, dy);
      const power = (d - 20) / (FAR - 20), len = power * MAX;
      const start = [REST[0], REST[1] + 20];
      await pull(start, [start[0] - dx / d * len, start[1] - dy / d * len], { shotName: i === 1 && name !== "서울" ? `2-aim-${name}` : undefined });
      await page.waitForFunction(() => !document.querySelector("#status").textContent.startsWith("힘"), null, { timeout: 5000 });
      await page.waitForTimeout(1200);
      const got = await page.evaluate(() => document.querySelector(".result .name")?.textContent ?? document.querySelector("#status").textContent);
      if (got === name) { targets[name] = i; break; }
    }
    if (targets[name]) await page.screenshot({ path: `${dir}/${tag}-3-hit-${name}.png` });
  }
  console.log(tag, targets);
  for (const [n, tries] of Object.entries(targets)) assert.ok(tries > 0, `${n}: 10번 안에 못 맞힘`);

  await page.close();
}

// 다트 확대 (6배)
const zoom = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 6 });
await zoom.goto(BASE);
await zoom.click("[data-mode=dart]");
const box = await zoom.locator("#dart").boundingBox();
await zoom.screenshot({ path: `${dir}/dart-zoom.png`, clip: { x: box.x - 20, y: box.y - 10, width: box.width + 40, height: box.height + 20 } });

await browser.close();
console.log(`OK → ${dir}/`);
