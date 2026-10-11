// B3 카드 3장 점검: `npx vite preview --port 4173` 띄운 상태에서 `node cards.mjs` (캡처·영상은 shots/B3)
// 3장이 한 화면에 · 키보드로 뒤집기·고르기 · 모션 줄이기면 바로 펼쳐짐 · 필터(제주만)면 제주만 나옴
import { chromium } from "playwright";
import assert from "node:assert";
import fs from "node:fs";

const B = process.env.BASE || "http://localhost:4173", dir = "shots/B3";
fs.mkdirSync(dir, { recursive: true });
const browser = await chromium.launch();
const open = async (width, opts = {}) => {
  const ctx = await browser.newContext({ viewport: { width, height: width > 500 ? 800 : 844 }, deviceScaleFactor: 2, ...opts });
  const page = await ctx.newPage();
  page.errs = []; page.on("pageerror", (e) => page.errs.push(e.message));
  await page.goto(B); await page.waitForSelector("#regions path");
  await page.click("[data-mode=cards]");
  return page;
};

for (const [tag, width] of [["mobile", 390], ["pc", 1280]]) {
  const page = await open(width, { recordVideo: { dir: `${dir}/video-${tag}`, size: width > 500 ? { width: 1280, height: 800 } : { width: 390, height: 844 } } });
  await page.click("#draw");
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${dir}/${tag}-1-shuffle.png` });
  await page.waitForSelector(".deck[data-phase=dealt]");
  await page.waitForTimeout(700);
  // 3장이 한 화면에 (가로로 안 넘치고, 세로로 화면 안)
  const boxes = await page.locator(".card").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()));
  assert.equal(boxes.length, 3);
  for (const b of boxes) assert.ok(b.left >= 0 && b.right <= width && b.top >= 0 && b.bottom <= (width > 500 ? 800 : 844), `카드가 화면 밖: ${JSON.stringify(b)}`);
  await page.screenshot({ path: `${dir}/${tag}-2-dealt.png` });

  // 키보드: Tab으로 카드에 가서 Enter로 뒤집기 ×3, 그다음 Enter로 고르기
  const cards = page.locator(".card");
  for (let k = 0; k < 3; k++) {
    await cards.nth(k).focus(); await page.keyboard.press(k === 1 ? "Space" : "Enter");
    await page.waitForTimeout(k === 0 ? 200 : 600);
    if (k === 0) await page.screenshot({ path: `${dir}/${tag}-3-flip.png` }); // 지도 깜빡임 중
  }
  assert.equal(await page.locator(".card[data-open]").count(), 3);
  await page.screenshot({ path: `${dir}/${tag}-4-open.png` });
  await cards.nth(1).focus(); await page.keyboard.press("Enter");
  await page.waitForTimeout(900);
  const label = await cards.nth(1).getAttribute("aria-label");
  assert.equal(await page.locator("#map path.picked").count(), 1);
  assert.ok(await page.isVisible("#go"), "고른 뒤 일정 짜기 버튼이 없음");
  assert.ok(label.includes(await page.textContent("#map .label")), `지도 강조(${await page.textContent("#map .label")})와 고른 카드(${label})가 다름`);
  await page.screenshot({ path: `${dir}/${tag}-5-chosen.png` });
  assert.deepEqual(page.errs, []);
  await page.context().close(); // 영상 저장
}

// 모션 줄이기: 누르자마자 펼쳐진 상태
{
  const page = await open(390, { reducedMotion: "reduce" });
  await page.click("#draw");
  assert.equal(await page.getAttribute(".deck", "data-phase"), "dealt");
  await page.screenshot({ path: `${dir}/mobile-6-reduced.png` });
  await page.context().close();
}

// 필터: 제주만 → 30번 뽑아도 제주시·서귀포시만, 카드는 2장
{
  const page = await open(390, { reducedMotion: "reduce" });
  await page.click(".filter summary"); await page.click(`.chips button:text-is("제주")`);
  for (let i = 0; i < 30; i++) {
    await page.click("#draw");
    const n = await page.locator(".card").count();
    assert.equal(n, 2);
    for (let k = 0; k < n; k++) await page.locator(".card").nth(k).click();
    const names = await page.locator(".card").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
    assert.ok(names.every((s) => s.startsWith("제주 ")), `제주 밖이 나옴: ${names}`);
  }
  assert.deepEqual(page.errs, []);
  await page.context().close();
}

await browser.close();
console.log(`OK → ${dir}/`);
