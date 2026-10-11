import { useEffect, useRef } from "react";

// ── 다트: 아래로 끌었다 놓으면 날아감. 지도는 바닥에 깔린 판이라고 보고 높이(z)·중력·바람 시뮬레이션 ──
// 애니메이션은 매 프레임 React를 거치지 않고 SVG 속성을 직접 바꾼다.
const MAX_PULL = 130, G = 1600;

export default function Dart({ svgRef, pathsRef, data, setBusy, setStatus, onPick }) {
  const dartRef = useRef(), shadowRef = useRef(), aimRef = useRef();
  const MAP_H = data.h, REST = { x: 200, y: MAP_H + 30 };

  useEffect(() => {
    const svg = svgRef.current, l = aimRef.current;
    let aim = null, wind = { x: 0, y: 0 }, busy = false;

    function toSvg(e) {
      const pt = svg.createSVGPoint();
      pt.x = e.clientX; pt.y = e.clientY;
      return pt.matrixTransform(svg.getScreenCTM().inverse());
    }
    function drawDart(x, y, z = 0, angle = 0, scale = 1) {
      const dart = dartRef.current, shadow = shadowRef.current;
      if (!dart) return; // 탭을 바꿔 사라진 뒤 남은 프레임
      dart.setAttribute("transform", `translate(${x} ${y - z * 0.35}) rotate(${angle}) scale(${scale * (1 + z / 450)})`);
      shadow.setAttribute("cx", x); shadow.setAttribute("cy", y);
      shadow.setAttribute("rx", 5 + z / 25);
      shadow.setAttribute("opacity", z > 0 ? Math.max(0.08, 0.3 - z / 1500) : 0);
    }
    function resetDart() {
      l.setAttribute("hidden", "");
      drawDart(REST.x, REST.y);
    }
    function newWind() {
      const a = Math.random() * Math.PI * 2, s = Math.random() * 3; // m/s
      wind = { x: Math.cos(a) * s * 45, y: Math.sin(a) * s * 45 };
      const arrow = "→↘↓↙←↖↑↗"[Math.round(a / (Math.PI / 4)) % 8];
      setStatus(["지도 아무 데나 누르고 아래로 당겼다 놓아요", `바람 ${arrow} ${s.toFixed(1)}m/s · 세게 당길수록 멀리`]);
    }

    function down(e) {
      if (busy) return;
      const p = toSvg(e);
      aim = { x: 0, y: 0, sx: p.x, sy: p.y }; // 지도 아무 데서나 잡고, 누른 점 기준으로 당긴 만큼이 힘
      svg.setPointerCapture(e.pointerId);
    }
    function move(e) {
      if (!aim) return;
      const p = toSvg(e);
      let dx = p.x - aim.sx, dy = p.y - aim.sy;
      const len = Math.hypot(dx, dy);
      if (len > MAX_PULL) { dx *= MAX_PULL / len; dy *= MAX_PULL / len; }
      aim = { ...aim, x: dx, y: dy };
      const ang = Math.atan2(-dy, -dx) * 180 / Math.PI + 90;
      drawDart(REST.x + dx * 0.25, REST.y + dy * 0.25, 0, ang); // 다트는 조금만 끌려와 화면 안에 머묾
      l.removeAttribute("hidden"); // SVG 요소는 .hidden 속성이 없음
      l.setAttribute("x1", REST.x + dx * 0.25); l.setAttribute("y1", REST.y + dy * 0.25);
      l.setAttribute("x2", REST.x - dx * 1.5); l.setAttribute("y2", REST.y - dy * 1.5);
      setStatus([`힘 ${Math.round((Math.hypot(dx, dy) / MAX_PULL) * 100)}%`, "놓으면 날아가요"]);
    }
    function up() {
      if (!aim) return;
      const pull = aim; aim = null;
      l.setAttribute("hidden", "");
      const power = Math.hypot(pull.x, pull.y) / MAX_PULL;
      if (power < 0.15) { resetDart(); newWind(); return; }
      throwDart(REST.x + pull.x * 0.25, REST.y + pull.y * 0.25, Math.atan2(-pull.y, -pull.x), power);
    }

    function throwDart(x, y, dir, power) {
      busy = true; setBusy(true); onPick(null);
      dir += (Math.random() - 0.5) * 0.14 * power; // 세게 던질수록 손이 떨림
      const speed = 120 + 620 * power; // 최대 힘 ≈ 지도 맨 위
      let vx = Math.cos(dir) * speed, vy = Math.sin(dir) * speed, vz = 450 + 250 * power, z = 0;
      let t0 = performance.now();
      const frame = (now) => {
        const dt = Math.min(0.033, Math.max(0, now - t0) / 1000); t0 = now; // rAF 시각이 던진 시각보다 앞설 수 있음
        vx += wind.x * dt; vy += wind.y * dt;
        vx *= 1 - 0.12 * dt; vy *= 1 - 0.12 * dt; // 공기저항
        vz -= G * dt;
        x += vx * dt; y += vy * dt; z += vz * dt;
        const ang = Math.atan2(vy, vx) * 180 / Math.PI + 90;
        if (z > 0 || vz > 0) { drawDart(x, y, z, ang); return requestAnimationFrame(frame); }
        land(x, y, ang);
      };
      requestAnimationFrame(frame);
    }

    function land(x, y, ang) {
      // 꽂힌 뒤 감쇠 진동으로 부르르
      const start = performance.now();
      const wobble = (now) => {
        const t = (now - start) / 1000;
        drawDart(x, y, 0, ang + 14 * Math.exp(-7 * t) * Math.sin(40 * t), 0.8);
        if (t < 0.7) requestAnimationFrame(wobble);
      };
      requestAnimationFrame(wobble);
      const pt = svg.createSVGPoint(); pt.x = x; pt.y = y;
      const i = y < MAP_H ? pathsRef.current.findIndex((p) => p.isPointInFill(pt)) : -1;
      busy = false; setBusy(false);
      if (i >= 0) onPick(data.regions[i]);
      else setTimeout(() => {
        if (!dartRef.current) return;
        setStatus(["풍덩, 바다에 빠졌어요", "다시 던져보세요"]);
        setTimeout(() => { if (dartRef.current) { resetDart(); newWind(); } }, 1200);
      }, 300);
    }

    resetDart(); newWind();
    svg.addEventListener("pointerdown", down);
    svg.addEventListener("pointermove", move);
    svg.addEventListener("pointerup", up);
    return () => {
      svg.removeEventListener("pointerdown", down);
      svg.removeEventListener("pointermove", move);
      svg.removeEventListener("pointerup", up);
    };
  }, []);

  return <>
    <rect id="zone" className="zone" x="0" y={MAP_H + 6} width="400" height="74" rx="8" />
    <g className="dartLayer">
      <line id="aim" ref={aimRef} strokeWidth="2" strokeDasharray="6 5" hidden />
      <ellipse id="shadow" ref={shadowRef} rx="6" ry="3" opacity="0" />
      <g id="dart" ref={dartRef}><g transform="translate(0 24)">{/* 바늘 끝이 기준점(0,0) = 판정 지점 */}
        <path className="dart-tip" d="M0-24 L2-14 L-2-14Z" />
        <rect className="dart-body" x="-2.5" y="-14" width="5" height="26" rx="2" />
        <path className="dart-wing" d="M0 6 L-9 20 L0 16 L9 20Z" />
      </g></g>
    </g>
  </>;
}
