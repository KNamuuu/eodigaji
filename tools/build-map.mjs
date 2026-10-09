// 시·군 단위 SVG 경로 생성 → public/regions.json  (실행: node tools/build-map.mjs)
import fs from "node:fs";
import { merge } from "topojson-client";
import { presimplify, simplify, quantile } from "topojson-simplify";
import { geoMercator, geoPath } from "d3-geo";

const SRC = "https://raw.githubusercontent.com/southkorea/southkorea-maps/master/kostat/2018/json/skorea-municipalities-2018-topo-simple.json";
let topo = await (await fetch(SRC)).json();
topo = presimplify(topo);
topo = simplify(topo, quantile(topo, 0.3)); // 점 70% 제거, 폰 화면엔 충분
const geoms = Object.values(topo.objects)[0].geometries;

const PROV = { 11: "서울", 21: "부산", 22: "대구", 23: "인천", 24: "광주", 25: "대전", 26: "울산", 29: "세종",
  31: "경기", 32: "강원", 33: "충북", 34: "충남", 35: "전북", 36: "전남", 37: "경북", 38: "경남", 39: "제주" };

// 광역시의 구는 시 하나로, 일반시의 구(수원시장안구)는 시로 합침. 군은 그대로.
function unit(p) {
  const code = p.code.slice(0, 2), prov = PROV[code];
  if (code < 30 && !p.name.endsWith("군")) return { name: code === "29" ? "세종시" : prov, prov };
  return { name: p.name.match(/^(.+?시).+구$/)?.[1] ?? p.name, prov };
}

const groups = new Map();
for (const g of geoms) {
  const u = unit(g.properties), key = u.prov + u.name;
  if (!groups.has(key)) groups.set(key, { ...u, geoms: [] });
  groups.get(key).geoms.push(g);
}

const W = 400, PAD = 12;
const features = [...groups.values()].map((u) => ({ ...u, geo: merge(topo, u.geoms) }));
const fc = (fs) => ({ type: "FeatureCollection", features: fs.map((f) => ({ type: "Feature", geometry: f.geo })) });
// 백령도(옹진)·독도(울릉) 때문에 지도가 작아지므로 본토 기준으로 맞추고 울릉군은 오른쪽 위 박스로 뺌
const isInset = (f) => f.name === "울릉군";
const proj = geoMercator().fitWidth(W - PAD * 2, fc(features.filter((f) => !isInset(f) && f.name !== "옹진군")));
proj.translate([proj.translate()[0] + PAD, proj.translate()[1] + PAD]);
const path = geoPath(proj).digits(1);
const H = Math.ceil(path.bounds(fc(features.filter((f) => !isInset(f) && f.name !== "옹진군")))[1][1]) + PAD;

// 울릉도 본섬만 확대해서 박스에 넣고, 독도는 점으로 표시
const ulleung = features.find(isInset);
const island = { type: "MultiPolygon", coordinates: (ulleung.geo.type === "Polygon" ? [ulleung.geo.coordinates] : ulleung.geo.coordinates).filter((poly) => poly[0].every(([lon]) => lon < 131)) };
const box = { x: W - PAD - 90, y: PAD, w: 90, h: 64 };
const insetProj = geoMercator().fitExtent([[box.x + 8, box.y + 8], [box.x + box.w - 30, box.y + box.h - 8]], island);
const insetPath = geoPath(insetProj).digits(1);
box.dokdo = [box.x + box.w - 14, box.y + box.h / 2];
ulleung.geo = island;

const regions = features.map((f, i) => {
  const pth = isInset(f) ? insetPath : path;
  const [cx, cy] = pth.centroid(f.geo);
  return { id: i, name: f.name, prov: f.prov, d: pth(f.geo), cx: +cx.toFixed(1), cy: +cy.toFixed(1) };
});
fs.writeFileSync("public/regions.json", JSON.stringify({ w: W, h: H, inset: box, regions }));
console.log(regions.length, "regions", W, "x", H, box);
