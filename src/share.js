// 정복 지도 공유 카드: regions.json path를 그대로 Path2D로 canvas에 그려 PNG(1080×1350) Blob으로
// photos = { 지역 index: 썸네일 URL } → 그 지역은 path로 clip()해서 사진으로 채움 (CORS 안 되는 사진은 색으로)
// 왼쪽 지도(다녀온 곳 칠함) + 위 "167곳 중 N곳 · 전국 X%" + 오른쪽 도별 n/전체 막대, 다 가본 도는 "완주"
import { bbox } from "./regions.js";

const load = (src) => new Promise((ok) => { const im = new Image(); im.crossOrigin = "anonymous"; im.onload = () => ok(im); im.onerror = () => ok(null); im.src = src; });

export async function drawCard(data, visited, photos = {}) {
  const W = 1080, H = 1350, font = getComputedStyle(document.body).fontFamily;
  const css = getComputedStyle(document.documentElement), c = (k) => css.getPropertyValue("--color-" + k).trim();
  const total = data.regions.length, n = visited.size, pct = Math.round((n / total) * 100);
  const provs = new Map();
  data.regions.forEach((r, i) => { const p = provs.get(r.prov) ?? { n: 0, all: 0 }; p.all++; if (visited.has(i)) p.n++; provs.set(r.prov, p); });
  const text = "어디가지내정복지도곳중전국완주%0123456789/·" + [...provs.keys()].join("");
  const imgs = Object.fromEntries(await Promise.all(Object.entries(photos).map(async ([i, u]) => [i, await load(u)])));
  await Promise.all(["400", "700"].map((w) => document.fonts.load(`${w} 40px ${font}`, text))); // 서브셋 글꼴이 아직 안 받아졌으면 받고 그림

  const cv = Object.assign(document.createElement("canvas"), { width: W, height: H }), g = cv.getContext("2d");
  g.fillStyle = c("paper"); g.fillRect(0, 0, W, H);
  g.textBaseline = "alphabetic";
  g.fillStyle = c("ink-2"); g.font = `600 32px ${font}`; g.fillText("어디가지 · 내 정복 지도", 64, 104);
  g.fillStyle = c("ink"); g.font = `700 88px ${font}`; g.fillText(`${total}곳 중 ${n}곳`, 64, 210);
  g.fillStyle = c("accent"); g.font = `700 44px ${font}`; g.fillText(`전국 ${pct}%`, 64, 278);

  // 지도: 바다 박스 안에 비율 유지
  const mx = 48, my = 330, mw = 600, mh = H - my - 48, s = Math.min((mw - 48) / data.w, (mh - 48) / data.h);
  g.fillStyle = c("sea"); g.beginPath(); g.roundRect(mx, my, mw, mh, 24); g.fill();
  g.save();
  g.translate(mx + (mw - data.w * s) / 2, my + (mh - data.h * s) / 2); g.scale(s, s);
  g.lineWidth = 0.5; g.strokeStyle = c("land-line"); g.lineJoin = "round";
  data.regions.forEach((r, i) => {
    const p = new Path2D(r.d), im = imgs[i];
    g.fillStyle = visited.has(i) ? c("visited") : c("paper"); g.fill(p);
    if (im) { // object-fit: cover로 지역 경계 상자에
      const [x, y, w, h] = bbox(r), k = Math.max(w / im.width, h / im.height);
      g.save(); g.clip(p); g.drawImage(im, x + (w - im.width * k) / 2, y + (h - im.height * k) / 2, im.width * k, im.height * k); g.restore();
    }
    g.stroke(p);
  });
  g.fillStyle = c("ink-2"); g.beginPath(); g.arc(data.dokdo[0], data.dokdo[1], 1.5, 0, 7); g.fill(); // 독도
  g.restore();

  // 도별: 이름 · 막대 · n/전체 (다 가본 도는 accent + "완주")
  const lx = 690, lw = W - lx - 64, row = (mh - 8) / provs.size;
  [...provs].forEach(([name, p], k) => {
    const y = my + 8 + row * k + row / 2, done = p.n === p.all;
    g.font = `${done ? 700 : 400} 26px ${font}`; g.fillStyle = done ? c("accent") : c("ink");
    g.textBaseline = "middle"; g.textAlign = "left"; g.fillText(name, lx, y);
    g.textAlign = "right"; g.fillStyle = done ? c("accent") : c("ink-2"); g.fillText(done ? "완주" : `${p.n}/${p.all}`, lx + lw, y);
    const bx = lx + 72, bw = lw - 72 - 84;
    g.fillStyle = c("zone"); g.beginPath(); g.roundRect(bx, y - 5, bw, 10, 5); g.fill();
    if (p.n) { g.fillStyle = done ? c("accent") : c("visited"); g.beginPath(); g.roundRect(bx, y - 5, Math.max(10, (bw * p.n) / p.all), 10, 5); g.fill(); }
  });
  return new Promise((ok) => cv.toBlob(ok, "image/png"));
}
