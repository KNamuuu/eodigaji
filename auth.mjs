// A2 로그인 점검: `npx vite preview --port 4173` 띄운 상태에서 `node auth.mjs` (가짜 세션으로 유지·로그아웃·next 리다이렉트 확인, 캡처는 shots/A2)
import { chromium } from "playwright";
import assert from "node:assert";
const B = process.env.BASE || "http://localhost:4173", dir = process.cwd() + "/shots/A2";
const browser = await chromium.launch();
const fake = { access_token: "x", token_type: "bearer", expires_in: 3600, expires_at: 9999999999, refresh_token: "r",
  user: { id: "00000000-0000-0000-0000-000000000001", aud: "authenticated", role: "authenticated", email: "terry@example.com", user_metadata: { name: "김동하여행" }, app_metadata: {} } };
for (const [tag, width, height] of [["mobile", 390, 844], ["pc", 1280, 800]]) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(B); await page.waitForSelector("#regions path");
  await page.waitForSelector("a.who");
  await page.screenshot({ path: `${dir}/${tag}-1-home-out.png` });
  // 비로그인으로 뽑기 가능
  await page.click("#spin"); await page.waitForSelector("#go:not([hidden])", { timeout: 15000 });
  await page.click("a.who"); await page.waitForSelector("#login");
  assert.match(page.url(), /\/login\?next=%2F/);
  await page.screenshot({ path: `${dir}/${tag}-2-login.png`, fullPage: true });
  // 지난 실패의 ?error=가 붙은 페이지에서 다시 로그인 → 돌아올 주소엔 error가 없어야 함 (있으면 supabase-js가 토큰을 버림)
  await page.goto(B + "/login?next=" + encodeURIComponent("/me?error=invalid_scope&error_description=x&keep=1"));
  await page.route("**/auth/v1/authorize**", (r) => r.abort());
  const [req] = await Promise.all([page.waitForRequest("**/auth/v1/authorize**"), page.click("#login .btn.kakao")]);
  assert.equal(new URL(req.url()).searchParams.get("redirect_to"), B + "/me?keep=1");
  await page.unroute("**/auth/v1/authorize**"); await page.goto(B);
  // 로그인 상태(가짜 세션) → 새로고침해도 유지
  await page.evaluate((s) => localStorage.setItem("sb-ltbhffozitpbsxjbnbnd-auth-token", JSON.stringify(s)), fake);
  await page.goto(B); await page.waitForSelector("div.who span");
  await page.reload(); await page.waitForSelector("div.who span");
  assert.equal(await page.textContent("div.who span"), "김동하여행");
  await page.screenshot({ path: `${dir}/${tag}-3-home-in.png` });
  await page.goto(B + "/login?next=/me"); await page.waitForURL(/\/me$/); // 로그인 상태면 바로 next로
  await page.goto(B + "/login?next=//evil.com"); await page.waitForURL(B + "/");
  await page.click("div.who button"); await page.waitForSelector("a.who");
  assert.equal(await page.evaluate(() => localStorage.getItem("sb-ltbhffozitpbsxjbnbnd-auth-token")), null);
  assert.deepEqual(errs, []);
  console.log(tag, "ok");
}
await browser.close();
