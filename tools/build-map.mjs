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
// 백령도(옹진)·독도(울릉) 때문에 지도가 작아지므로 본토 기준으로 맞춤. 울릉군은 높이(위도)는 그대로, 동쪽 거리만 줄여 울진 앞바다에 둠
const isUlleung = (f) => f.name === "울릉군";
const mainland = fc(features.filter((f) => !isUlleung(f) && f.name !== "옹진군"));
const proj = geoMercator().fitWidth(W - PAD * 2, mainland);
proj.translate([proj.translate()[0] + PAD, proj.translate()[1] + PAD]);
const path = geoPath(proj).digits(1);
const H = Math.ceil(path.bounds(mainland)[1][1]) + PAD;

// 울릉도 본섬만 남기고(독도는 점) 가로 약 495 → 376으로 옮김. 실제 크기는 점에 가까우니 판정은 원(hit)으로 넉넉히
const ulleung = features.find(isUlleung);
ulleung.geo = { type: "MultiPolygon", coordinates: (ulleung.geo.type === "Polygon" ? [ulleung.geo.coordinates] : ulleung.geo.coordinates).filter((poly) => poly[0].every(([lon]) => lon < 131)) };
const ULLEUNG_X = 376, DOKDO_X = 392;
const shift = ULLEUNG_X - path.centroid(ulleung.geo)[0];
const ulleungPath = geoPath(geoMercator().scale(proj.scale()).translate([proj.translate()[0] + shift, proj.translate()[1]])).digits(1);
const dokdo = [DOKDO_X, +proj([131.8697, 37.2417])[1].toFixed(1)];

const regions = features.map((f, i) => {
  const pth = isUlleung(f) ? ulleungPath : path;
  const [cx, cy] = pth.centroid(f.geo).map((v) => +v.toFixed(1));
  const hit = isUlleung(f) ? { hit: [[cx, cy, 12], [...dokdo, 7]] } : {};
  return { id: i, name: f.name, prov: f.prov, d: pth(f.geo), cx, cy, ...hit };
});
fs.writeFileSync("public/regions.json", JSON.stringify({ w: W, h: H, dokdo, regions }));
console.log(regions.length, "regions", W, "x", H, "dokdo", dokdo);
