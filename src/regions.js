import { useEffect, useState } from "react";

let cache;
export function useRegions() {
  const [data, setData] = useState(null);
  useEffect(() => { (cache ??= fetch("/regions.json").then((r) => r.json())).then(setData); }, []);
  return data;
}

// 지역 경계 상자 [x, y, w, h]: path가 M·L·Z 절대좌표뿐이라 숫자 쌍의 최소·최대로 충분
const boxes = new WeakMap();
export function bbox(r) {
  if (!boxes.has(r)) {
    const n = r.d.match(/-?[\d.]+/g).map(Number), xs = n.filter((_, i) => i % 2 === 0), ys = n.filter((_, i) => i % 2);
    const x0 = Math.min(...xs), y0 = Math.min(...ys);
    boxes.set(r, [x0, y0, Math.max(...xs) - x0, Math.max(...ys) - y0]);
  }
  return boxes.get(r);
}

// 썸네일 경로: photos/{uid}/{post}/3.webp → photos/{uid}/{post}/t3.webp (지도·카드엔 이것만)
export const thumbOf = (p) => p.replace(/\/(\d+)(\.\w+)$/, "/t$1$2");
