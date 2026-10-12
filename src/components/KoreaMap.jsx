import { useEffect, useRef, useState } from "react";
import { bbox } from "../regions.js";

// regions.json 지도. pathsRef로 지역 path DOM을 넘겨준다 (룰렛 깜빡임·다트 판정용). out = 흐리게 할 지역 index Set
// view = viewBox 덮어쓰기 (지역 확대). visited = 칠할 지역 index Set, regionProps(r, i) = 지역 path에 붙일 이벤트 등 (내 지도)
// photos = { 지역 index: 사진 URL } → 그 지역 모양(clipPath)대로 사진을 채운다. path는 위에 투명하게 남아 이벤트·테두리를 맡음
export default function KoreaMap({ data, height, view, picked, out, visited, photos, regionProps, svgRef, pathsRef, children }) {
  const has = (i) => photos?.[i] !== undefined, k = view ? +view.split(" ")[2] / 400 : 1; // 확대해도 글씨 크기 그대로
  return (
    <svg id="map" ref={svgRef} viewBox={view ?? `0 0 400 ${height ?? data?.h ?? 672}`}>
      {photos && <g id="photos">
        {Object.entries(photos).map(([i, url]) => {
          const r = data.regions[i], [x, y, w, h] = bbox(r);
          return <g key={i}>
            <clipPath id={"clip-" + i}><path d={r.d} /></clipPath>
            <image href={url} x={x} y={y} width={w} height={h} preserveAspectRatio="xMidYMid slice" clipPath={`url(#clip-${i})`} />
          </g>;
        })}
      </g>}
      <g id="regions">
        {data?.regions.map((r, i) => (
          <path key={r.id} d={r.d} className={[picked === r ? "picked" : out?.has(i) ? "out" : visited?.has(i) ? "visited" : "", has(i) ? "photo" : ""].join(" ").trim() || undefined} {...regionProps?.(r, i)} ref={pathsRef && ((el) => { pathsRef.current[i] = el; })} />
        ))}
      </g>
      {data && <g id="dokdo">
        <circle cx={data.dokdo[0]} cy={data.dokdo[1]} r={1.5 * Math.max(k, 1 / 4)} />
        <text x={data.dokdo[0]} y={data.dokdo[1] + 10 * k} fontSize={7 * k} textAnchor="middle">독도</text>
      </g>}
      {picked && <g id="labels"><text className="label" x={picked.cx} y={picked.cy - 8 * k} style={k === 1 ? undefined : { fontSize: 14 * k, strokeWidth: 4 * k }}>{picked.name}</text></g>}
      {children}
    </svg>
  );
}

// 확대·이동: 휠(커서 기준)·핀치·드래그·두 번 탭(다녀온 곳 말고)으로 viewBox 조절, zoom(f)는 [+][−] 버튼용(가운데 기준)
// 6px 넘게 움직였으면 그 뒤 click은 삼킨다 (탭 미리보기와 안 겹치게). home = 처음·[다시 맞추기] 화면 "x y w h" (없으면 전국)
// 반환 { view: 지금 viewBox, moved: home과 다른지, reset, zoom }
export function usePanZoom(ref, w, h, home) {
  const full = `0 0 ${w} ${h}`, base = home ?? full;
  const [view, setView] = useState(base), cur = useRef(null), api = useRef({});
  useEffect(() => { cur.current = null; setView(base); }, [base]);
  useEffect(() => {
    const svg = ref.current;
    if (!svg || !h) return;
    const MAX = 8, pts = new Map();
    let start = null, moved = false, tap = null;
    const get = () => cur.current ?? base.split(" ").map(Number);
    const set = (v) => {
      const [vw, vh] = [v[2], v[3]];
      const x = Math.min(Math.max(v[0], -vw / 2), w - vw / 2), y = Math.min(Math.max(v[1], -vh / 2), h - vh / 2); // 가운데가 지도 밖으로 안 나가게
      cur.current = vw >= w - 0.01 ? [0, 0, w, h] : [x, y, vw, vh];
      const s = cur.current.map((n) => +n.toFixed(2)).join(" ");
      svg.setAttribute("viewBox", s); // 다음 move의 getScreenCTM이 바로 새 값을 보게
      setView(s);
    };
    // 시작 시점 화면좌표 m0의 지점이 m1에 오도록, f배 확대 (전국 크기 ~ 8배 사이)
    const move = (v, ctm, m0, m1, f) => {
      const [x, y, vw, vh] = v, u = (c) => [(c[0] - ctm.e) / ctm.a, (c[1] - ctm.f) / ctm.d];
      f = Math.min(Math.max(f, vw / w), (vw * MAX) / w);
      const a = u(m0), b = u(m1);
      set([a[0] - (b[0] - x) / f, a[1] - (b[1] - y) / f, vw / f, vh / f]);
    };
    const center = () => { const r = svg.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
    api.current.zoom = (f) => { const c = center(); move(get(), svg.getScreenCTM(), c, c, f); };
    const snap = () => { start = { v: get(), ctm: svg.getScreenCTM(), p: [...pts.values()].map((p) => [...p]) }; };
    const mid = (p) => [(p[0][0] + p[1][0]) / 2, (p[0][1] + p[1][1]) / 2], dist = (p) => Math.hypot(p[0][0] - p[1][0], p[0][1] - p[1][1]);

    const down = (e) => { if (!pts.size) moved = false; pts.set(e.pointerId, [e.clientX, e.clientY]); snap(); };
    const onMove = (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, [e.clientX, e.clientY]);
      const p = [...pts.values()], s = start.p;
      if (p.length === 1) {
        if (!moved && Math.hypot(p[0][0] - s[0][0], p[0][1] - s[0][1]) < 6) return;
        move(start.v, start.ctm, s[0], p[0], 1);
      } else move(start.v, start.ctm, mid(s), mid(p), dist(p) / dist(s));
      if (!moved) { moved = true; for (const id of pts.keys()) svg.setPointerCapture?.(id); } // 끌기 시작한 뒤에만 잡는다 (탭 click 대상이 svg로 바뀌지 않게)
    };
    const up = (e) => {
      const was = pts.size === 1 && !moved && pts.has(e.pointerId);
      pts.delete(e.pointerId); snap();
      if (!was || e.target.closest?.("[tabindex]")) return (tap = null); // 다녀온 곳의 두 번째 탭은 이동이라 확대 안 함
      const c = [e.clientX, e.clientY], t = e.timeStamp;
      if (tap && t - tap.t < 320 && Math.hypot(c[0] - tap.c[0], c[1] - tap.c[1]) < 30) { tap = null; move(get(), svg.getScreenCTM(), c, c, 2); }
      else tap = { t, c };
    };
    const click = (e) => { if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; } };
    const wheel = (e) => {
      e.preventDefault();
      const c = [e.clientX, e.clientY];
      move(get(), svg.getScreenCTM(), c, c, Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.002)));
    };
    const on = [["pointerdown", down], ["pointermove", onMove], ["pointerup", up], ["pointercancel", up], ["click", click, true], ["wheel", wheel]];
    on.forEach(([t, f, c]) => svg.addEventListener(t, f, c ?? { passive: false }));
    return () => on.forEach(([t, f, c]) => svg.removeEventListener(t, f, c ?? { passive: false }));
  }, [ref, w, h, base]);
  return { view, moved: view !== base, reset: () => { cur.current = null; setView(base); }, zoom: (f) => api.current.zoom?.(f) };
}

// 지도 위 [+][−][다시 맞추기] (키보드·한 손용)
export function ZoomButtons({ pz, label = "전체 보기" }) {
  return (
    <div className="zoom">
      {pz.moved && <button className="btn sub" id="fit" onClick={pz.reset}>{label}</button>}
      <button className="btn sub" aria-label="확대" onClick={() => pz.zoom(1.6)}>+</button>
      <button className="btn sub" aria-label="축소" onClick={() => pz.zoom(1 / 1.6)}>−</button>
    </div>
  );
}
