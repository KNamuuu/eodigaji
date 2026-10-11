// 사용: 서버 띄운 상태에서 `npm run shots -- A1/after`  (390px·1280px 주요 화면 캡처 + 간단 점검)
// Math.random을 고정 시드로 바꿔서, 같은 코드면 같은 지역이 뽑힌다 → 전/후 캡처 비교용
import { chromium } from "playwright";
import assert from "node:assert";
import fs from "node:fs";

const BASE = process.env.BASE || "http://localhost:3000";
const dir = `shots/${process.argv[2] || "latest"}`;
fs.mkdirSync(dir, { recursive: true });
const browser = await chromium.launch();

for (const [tag, width, height] of [["mobile", 390, 844], ["pc", 1280, 800]]) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
  await page.addInitScript(() => { let s; (window.seed = (n) => { s = n; })(7); Math.random = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32; });
  const seed = () => page.evaluate(() => seed(7)); // 라이브러리가 먼저 random을 써도 같은 결과가 나오게
  const shot = (name, opts) => page.screenshot({ path: `${dir}/${tag}-${name}.png`, ...opts });
  await page.goto(BASE);
  await page.waitForSelector("#regions path");
  assert.equal(await page.locator("#regions path").count(), 167);
  await shot("1-home");

  await seed();
  await page.click("#spin");
  await page.waitForSelector("#go:not([hidden])", { timeout: 15000 });
  await page.waitForTimeout(1000); // fill 전환 끝날 때까지
  await shot("2-picked");

  await page.click("#go");
  await page.waitForSelector("#planBody .row");
  await shot("3-plan", { fullPage: true });

  // 수정 → 다시 뽑기 → 같은 곳 다시 열면 남아 있어야 함
  await page.fill("#planTitle", "우리끼리 힐링 여행");
  await page.locator(".what").nth(1).fill("시장 가서 국밥 먹기");
  await page.click("#back");
  await page.waitForSelector("#go:not([hidden])");
  await page.click("#go");
  await page.waitForSelector("#planBody .row");
  assert.equal(await page.inputValue("#planTitle"), "우리끼리 힐링 여행");
  assert.equal(await page.locator(".what").nth(1).inputValue(), "시장 가서 국밥 먹기");
  await page.click("#back");

  await seed();
  await page.click("[data-mode=dart]");
  await page.waitForTimeout(300);
  await shot("4-dart");
  const box = await page.locator("#map").boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 10, cy + 60, { steps: 8 });
  await shot("5-dart-aiming");
  await page.mouse.up();
  await page.waitForTimeout(2500);
  await shot("6-dart-landed");
  await page.close();
}

await browser.close();
console.log(`OK → ${dir}/`);
