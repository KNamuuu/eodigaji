import { useEffect, useRef } from "react";

// ── 다트: 아무 데나 누르고 아래로 끌었다 놓으면 날아감. 지도는 바닥에 깔린 판이라고 보고 높이(z)·중력·바람 시뮬레이션 ──
// 애니메이션은 매 프레임 React를 거치지 않고 SVG 속성을 직접 바꾼다.
// 물리는 고정 간격(DT)으로 돌려서, 바람 0이면 예상 낙하 지점에 정확히 떨어진다.
export const ZONE_H = 120; // 지도 아래 던지는 판 높이
const MAX_PULL = 130, MIN_PULL = 8, DRAG = 0.2, G = 1600, DT = 1 / 120, K = 0.12, NEAR = 20;
const vz0 = (power) => 450 + 250 * power;
// 바람 0일 때 속도 1로 던지면 가는 거리 (공기저항 감안). 거리는 속도에 비례하니 필요한 속도 = 거리 / 이 값
function reachPerSpeed(power) {
  let vz = vz0(power), z = 0, r = 1, sum = 0;
  do { vz -= G * DT; z += vz * DT; r *= 1 - K * DT; sum += r * DT; } while (z > 0 || vz > 0);
  return sum;
}

export default function Dart({ svgRef, pathsRef, data, setBusy, setStatus, onPick, outRef }) {
  const dartRef = useRef(), flightsRef = useRef(), shadowRef = useRef(), aimRef = useRef(), targetRef = useRef(),
    ringRef = useRef(), bandRef = useRef(), hintRef = useRef(), rippleRef = useRef();
  const MAP_H = data.h, REST = { x: 200, y: MAP_H + 46 };
  const FAR = REST.y - 10; // 힘 100% = 지도 맨 위

  useEffect(() => {
    const svg = svgRef.current, aimL = aimRef.current, target = targetRef.current, ring = ringRef.current, band = bandRef.current;
    let aim = null, wind = { x: 0, y: 0 }, windStatus, busy = false;
    const show = (el, on) => on ? el.removeAttribute("hidden") : el.setAttribute("hidden", ""); // SVG 요소는 .hidden 속성이 없음
    const set = (el, attrs) => { for (const k in attrs) el.setAttribute(k, attrs[k]); };

    function toSvg(e) {
      const pt = svg.createSVGPoint();
      pt.x = e.clientX; pt.y = e.clientY;
      return pt.matrixTransform(svg.getScreenCTM().inverse());
    }
    // spin: 대 축으로 도는 각도(날개 폭이 cos로 줄었다 늘었다), lean: 꽂혔을 때 비스듬히 누운 정도
    function drawDart(x, y, z = 0, angle = 0, { scale = 1, spin = 0, lean = 1 } = {}) {
      const dart = dartRef.current, shadow = shadowRef.current;
      if (!dart) return; // 탭을 바꿔 사라진 뒤 남은 프레임
      const s = scale * (1 + z / 450), c = Math.cos(spin);
      dart.setAttribute("transform", `translate(${x} ${y - z * 0.35}) rotate(${angle}) scale(${s} ${s * lean})`);
      flightsRef.current.setAttribute("transform", `scale(${Math.sign(c || 1) * Math.max(0.2, Math.abs(c))} 1)`);
      set(shadow, { cx: x, cy: y, rx: 5 + z / 25, opacity: z > 0 ? Math.max(0.08, 0.3 - z / 1500) : 0 });
    }
    function resetDart() {
      [aimL, target, ring, band].forEach((el) => show(el, false));
      show(hintRef.current, true);
      dartRef.current.removeAttribute("visibility");
      drawDart(REST.x, REST.y);
    }
    function newWind() {
      const a = Math.random() * Math.PI * 2, s = Math.random() * 3; // m/s
      wind = { x: Math.cos(a) * s * 45, y: Math.sin(a) * s * 45 };
      const arrow = "→↘↓↙←↖↑↗"[Math.round(a / (Math.PI / 4)) % 8];
      windStatus = ["어디서든 누르고 아래로 당겼다 놓아요", `바람 ${arrow} ${s.toFixed(1)}m/s · 점선 원은 바람 없을 때 떨어질 곳`];
      setStatus(windStatus);
    }
    const reach = (power) => NEAR + (FAR - NEAR) * power; // 힘 → 거리 직선 대응 (출발점 기준)

    function down(e) {
      if (busy) return;
      const p = toSvg(e);
      aim = { x: 0, y: 0, sx: p.x, sy: p.y }; // 누른 점 기준으로 당긴 만큼이 힘
      svg.setPointerCapture(e.pointerId);
      show(hintRef.current, false);
      set(ring, { cx: p.x, cy: p.y }); show(ring, true);
    }
    function move(e) {
      if (!aim) return;
      const p = toSvg(e);
      let dx = p.x - aim.sx, dy = p.y - aim.sy;
      const len = Math.hypot(dx, dy);
      if (len > MAX_PULL) { dx *= MAX_PULL / len; dy *= MAX_PULL / len; }
      aim = { ...aim, x: dx, y: dy };
      const a = Math.atan2(-dy, -dx), ang = a * 180 / Math.PI + 90, power = Math.hypot(dx, dy) / MAX_PULL;
      const bx = REST.x + dx * DRAG, by = REST.y + dy * DRAG; // 다트는 조금만 끌려와 화면 안에 머묾
      drawDart(bx, by, 0, ang);
      set(ring, { cx: p.x, cy: p.y });
      // 고무줄: 손가락 → 다트 꼬리
      const rad = ang * Math.PI / 180;
      set(band, { x1: p.x, y1: p.y, x2: bx - 40 * Math.sin(rad), y2: by + 40 * Math.cos(rad) }); show(band, true);
      const pulled = len >= MIN_PULL;
      if (pulled) {
        const tx = REST.x + Math.cos(a) * reach(power), ty = REST.y + Math.sin(a) * reach(power);
        set(aimL, { x1: bx, y1: by, x2: tx, y2: ty }); set(target, { cx: tx, cy: ty });
      }
      show(aimL, pulled); show(target, pulled);
      setStatus(pulled ? [`힘 ${Math.round(power * 100)}%`, "놓으면 날아가요"] : windStatus);
    }
    function up() {
      if (!aim) return;
      const pull = aim; aim = null;
      [aimL, target, ring, band].forEach((el) => show(el, false));
      const len = Math.hypot(pull.x, pull.y);
      if (len < MIN_PULL) { resetDart(); setStatus(windStatus); return; }
      throwDart(pull, len / MAX_PULL);
    }
    function cancel() { // 손가락이 화면 밖으로 나가는 등 끊기면 없던 일로
      if (!aim) return;
      aim = null; resetDart(); setStatus(windStatus);
    }

    function throwDart(pull, power) {
      busy = true; setBusy(true); onPick(null);
      let x = REST.x + pull.x * DRAG, y = REST.y + pull.y * DRAG;
      // 출발점(REST)에서 reach만큼 = 끌려온 다트 위치에서 reach + 끌려온 거리만큼
      const speed = (reach(power) + Math.hypot(pull.x, pull.y) * DRAG) / reachPerSpeed(power);
      const dir = Math.atan2(-pull.y, -pull.x) + (Math.random() - 0.5) * 0.14 * power; // 세게 던질수록 손이 떨림
      let vx = Math.cos(dir) * speed, vy = Math.sin(dir) * speed, vz = vz0(power), z = 0, spin = 0, acc = 0;
      let t0 = performance.now();
      const frame = (now) => {
        acc += Math.min(0.1, Math.max(0, now - t0) / 1000); t0 = now; // rAF 시각이 던진 시각보다 앞설 수 있음
        for (; acc >= DT; acc -= DT) {
          vx += wind.x * DT; vy += wind.y * DT;
          vx *= 1 - K * DT; vy *= 1 - K * DT; // 공기저항
          vz -= G * DT;
          x += vx * DT; y += vy * DT; z += vz * DT;
          spin += 18 * DT; // 초당 약 3바퀴
          if (z <= 0 && vz <= 0) return land(x, y, Math.atan2(vy, vx) * 180 / Math.PI + 90);
        }
        drawDart(x, y, z, Math.atan2(vy, vx) * 180 / Math.PI + 90, { spin });
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    }

    function regionAt(x, y) {
      if (y >= MAP_H) return -1;
      const pt = svg.createSVGPoint(); pt.x = x; pt.y = y;
      const i = pathsRef.current.findIndex((p) => p.isPointInFill(pt));
      return i >= 0 ? i : data.regions.findIndex((r) => r.hit?.some(([hx, hy, hr]) => Math.hypot(x - hx, y - hy) <= hr)); // 울릉도·독도
    }

    function land(x, y, ang) {
      const i = regionAt(x, y);
      busy = false; setBusy(false);
      if (i >= 0 && outRef.current.has(i)) { // 필터에서 뺀 곳: 꽂힌 채 잠깐 보여주고 다시
        drawDart(x, y, 0, ang, { scale: 0.8, lean: 0.6 });
        setStatus([data.regions[i].name, "필터에서 뺀 곳이에요 · 다시 던져보세요"]);
        busy = true; setBusy(true);
        return setTimeout(() => { busy = false; setBusy(false); if (dartRef.current) { resetDart(); newWind(); } }, 1200);
      }
      if (i >= 0) {
        navigator.vibrate?.(20);
        // 비스듬히 박힌 채(lean) 감쇠 진동으로 부르르
        const start = performance.now();
        const wobble = (now) => {
          const t = (now - start) / 1000;
          drawDart(x, y, 0, ang + 14 * Math.exp(-7 * t) * Math.sin(40 * t), { scale: 0.8, lean: 0.6 });
          if (t < 0.7) requestAnimationFrame(wobble);
        };
        requestAnimationFrame(wobble);
        return onPick(data.regions[i]);
      }
      // 바다: 다트는 가라앉고 물결 한 번
      dartRef.current.setAttribute("visibility", "hidden"); shadowRef.current.setAttribute("opacity", 0);
      const ripple = rippleRef.current, start = performance.now();
      set(ripple, { cx: x, cy: y }); show(ripple, true);
      const wave = (now) => {
        if (!rippleRef.current) return;
        const t = Math.min(1, (now - start) / 800);
        set(ripple, { r: 2 + 18 * t, opacity: 0.8 * (1 - t) });
        if (t < 1) requestAnimationFrame(wave); else show(ripple, false);
      };
      requestAnimationFrame(wave);
      setStatus(["풍덩, 바다에 빠졌어요", "다시 던져보세요"]);
      setTimeout(() => { if (dartRef.current && !busy) { resetDart(); newWind(); } }, 1200);
    }

    resetDart(); newWind();
    const on = [["pointerdown", down], ["pointermove", move], ["pointerup", up], ["pointercancel", cancel], ["lostpointercapture", cancel]];
    on.forEach(([t, f]) => svg.addEventListener(t, f));
    return () => on.forEach(([t, f]) => svg.removeEventListener(t, f));
  }, []);

  return <>
    <rect className="zone" x="0" y={MAP_H + 6} width="400" height={ZONE_H - 10} rx="8" />
    <text ref={hintRef} className="dart-hint" x={REST.x + 20} y={REST.y + 26}>어디서든 잡고 아래로</text>
    <g className="dartLayer">
      <circle ref={rippleRef} className="ripple" r="2" hidden />
      <circle ref={targetRef} id="target" r="8" strokeDasharray="3 3" hidden />
      <line ref={aimRef} id="aim" strokeWidth="2" strokeDasharray="6 5" hidden />
      <line ref={bandRef} id="band" strokeWidth="1.5" hidden />
      <circle ref={ringRef} id="ring" r="9" hidden />
      <ellipse ref={shadowRef} id="shadow" rx="6" ry="3" opacity="0" />
      {/* 촉 끝이 기준점(0,0) = 판정 지점. 위가 앞쪽, 길이 44 */}
      <g id="dart" ref={dartRef}>
        <g ref={flightsRef} className="dart-flights">
          <path d="M0 29 L-8 39 L-7.5 44 L0 41Z" />
          <path className="far" d="M0 29 L5 38 L4.8 42.5 L0 41Z" />
        </g>
        <rect className="dart-body" x="-0.8" y="21" width="1.6" height="20" />
        <rect className="dart-body" x="-2.6" y="9" width="5.2" height="13" rx="2" />
        <path className="dart-grip" d="M-2.6 12.5H2.6M-2.6 15.5H2.6M-2.6 18.5H2.6" />
        <path className="dart-tip" d="M0 0 L1 9.5 L-1 9.5Z" />
      </g>
    </g>
  </>;
}
