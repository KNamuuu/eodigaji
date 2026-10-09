// 사용: 서버 띄운 상태에서 `npm run shots -- v2`  (주요 흐름 캡처 + 간단 점검, 실패 시 assert로 멈춤)
import { chromium } from "playwright";
import assert from "node:assert";
import fs from "node:fs";

const dir = `shots/${process.argv[2] || "v2"}`;
fs.mkdirSync(dir, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const shot = (name, opts) => page.screenshot({ path: `${dir}/${name}.png`, ...opts });
await page.goto("http://localhost:3000");
await page.waitForSelector("#regions path");
assert.equal(await page.locator("#regions path").count(), 167);

// 1) 지도 룰렛
await shot("01-home");
await page.click("#spin");
await page.waitForTimeout(900);
await shot("02-roulette-spinning");
await page.waitForSelector("#go:not([hidden])", { timeout: 15000 });
await shot("03-roulette-picked");

// 2) 다트: 실제 드래그로 던지기 (바다에 빠지면 다시)
await page.click("[data-mode=dart]");
const box = await page.locator("#map").boundingBox();
const k = box.width / 400, rest = { x: box.x + 200 * k, y: box.y + 300 * k }; // 지도 한가운데서 잡기
for (let tries = 0; tries < 6; tries++) {
  await page.mouse.move(rest.x, rest.y);
  await page.mouse.down();
  await page.mouse.move(rest.x + 15 * k, rest.y + 75 * k, { steps: 8 });
  if (tries === 0) await shot("04-dart-aiming");
  await page.mouse.up();
  if (tries === 0) { await page.waitForTimeout(250); await shot("05-dart-flying"); }
  await page.waitForTimeout(1500);
  if (await page.locator("#go:not([hidden])").count()) break;
  await page.waitForTimeout(1500);
}
await page.waitForTimeout(500);
await shot("06-dart-landed");
const dartPick = await page.textContent("#status");

// 다트 분포 점검: 힘·방향을 바꿔 20번 던져 어디 꽂히는지
const hits = await page.evaluate(async () => {
  const out = [], orig = land;
  window.land = (x, y, a) => { orig(x, y, a); out.push(`${picked ? picked.name : "바다"}@${Math.round(x)},${Math.round(y)}`); };
  for (let n = 0; n < 20; n++) {
    newWind();
    throwDart(REST.x, REST.y + 40, -Math.PI / 2 + (Math.random() - 0.5) * 0.6, 0.2 + Math.random() * 0.8);
    await new Promise((r) => setTimeout(r, 1300));
  }
  window.land = orig;
  return out;
});

// 3) 일정 화면 + 수정
await page.click("[data-mode=roulette]");
await page.click("#spin");
await page.waitForSelector("#go:not([hidden])", { timeout: 15000 });
await page.click("#go");
await page.waitForSelector("#planBody .row");
await shot("07-plan", { fullPage: true });

await page.fill("#planTitle", "우리끼리 힐링 여행");
await page.locator(".what").nth(1).fill("시장 가서 국밥 먹기");
await page.locator("[data-del]").nth(3).click();                       // 1일차 마지막 삭제
await page.locator("[data-add='0']").click();                          // 1일차 일정 추가
await page.locator(".row").nth(3).locator(".what").fill("야경 보러 가기");
await page.locator(".row").nth(3).locator(".time").fill("20:00");
await page.locator(".row").nth(3).locator(".time").dispatchEvent("change");
await shot("08-plan-edited", { fullPage: true });

// 저장 확인: 다시 뽑기 → 같은 곳 일정 열면 수정본이 남아 있어야 함
const saved = await page.evaluate(() => JSON.parse(localStorage.getItem(planKey)));
assert.equal(saved.title, "우리끼리 힐링 여행");
assert.deepEqual(saved.days[0].items.slice(1).map((i) => i.time + " " + i.what), ["12:30 시장 가서 국밥 먹기", "15:00 대표 명소 구경", "20:00 야경 보러 가기"]);
await page.click("#back");
await page.click("#go");
await page.waitForSelector("#planBody .row");
assert.equal(await page.inputValue("#planTitle"), "우리끼리 힐링 여행");

await browser.close();
console.log(JSON.stringify({ dartPick, hits }, null, 1));
console.log(`OK → ${dir}/`);
