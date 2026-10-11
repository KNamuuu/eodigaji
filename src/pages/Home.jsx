import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import Layout from "../components/Layout.jsx";
import KoreaMap from "../components/KoreaMap.jsx";
import Dart from "../components/Dart.jsx";
import { useRegions } from "../regions.js";

const HELP = {
  roulette: "버튼을 누르면 지도 위를 빠르게 돌다가 한 곳에 멈춰요.",
  dart: "지도를 누른 채 아래로 당겼다 놓으면 다트가 날아가요. 바람을 보고 세기를 조절하세요.",
};
const pickedStatus = (r) => [r.name, `${r.prov} · 여기로 결정!`];
const idleStatus = ["어디로 갈까?", "버튼을 누르면 지도에 불이 들어와요"];

let saved = { mode: "roulette", picked: null, spun: false }; // 일정 보고 돌아와도 뽑은 곳 그대로

export default function Home() {
  const data = useRegions();
  const nav = useNavigate();
  const svgRef = useRef(), pathsRef = useRef([]), goRef = useRef();
  const [mode, setModeState] = useState(saved.mode);
  const [picked, setPicked] = useState(saved.picked);
  const [spun, setSpun] = useState(saved.spun);
  const [busy, setBusy] = useState(false);
  const [round, setRound] = useState(0); // 탭을 다시 누르면 다트 새로 (바람 새로)
  const [status, setStatus] = useState(saved.picked ? pickedStatus(saved.picked) : idleStatus);
  useEffect(() => { saved = { mode, picked, spun }; });

  function choose(r) {
    setPicked(r);
    if (!r) return;
    setStatus(pickedStatus(r));
    setTimeout(() => goRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
  }
  function setMode(m) {
    setModeState(m); setPicked(null); setRound((n) => n + 1);
    if (m === "roulette") setStatus(idleStatus);
  }

  // ── 지도 룰렛: 빠르게 깜빡이다 점점 느려지며 멈춤 ──
  function spin() {
    const regions = data.regions, paths = pathsRef.current;
    setBusy(true); setPicked(null);
    let delay = 30, last = -1;
    const step = () => {
      let i;
      do i = Math.floor(Math.random() * regions.length); while (i === last);
      last = i;
      const p = paths[i];
      p.classList.add("flash");
      requestAnimationFrame(() => requestAnimationFrame(() => p.classList.remove("flash"))); // 바로 꺼지며 fade out
      setStatus([regions[i].name, regions[i].prov]);
      delay *= 1.09;
      if (delay < 500) return setTimeout(step, delay);
      setTimeout(() => { choose(regions[i]); setBusy(false); setSpun(true); }, 350);
    };
    step();
  }

  const map = (
    <KoreaMap data={data} height={data && (mode === "dart" ? data.h + 80 : data.h)} picked={picked} svgRef={svgRef} pathsRef={pathsRef}>
      {data && mode === "dart" && <Dart key={round} svgRef={svgRef} pathsRef={pathsRef} data={data} setBusy={setBusy} setStatus={setStatus} onPick={choose} />}
    </KoreaMap>
  );
  return (
    <Layout view="home" map={map} status={status}>
      <section id="home" className="screen">
        <div className="tabs" role="tablist">
          {[["roulette", "지도 룰렛"], ["dart", "다트"]].map(([m, label]) => (
            <button key={m} data-mode={m} className={mode === m ? "active" : undefined} role="tab" onClick={() => !busy && setMode(m)}>{label}</button>
          ))}
        </div>
        <p className="help desk" id="help">{HELP[mode]}</p>
        <div className="result desk" id="result">
          {picked ? <><p className="prov">{picked.prov}</p><p className="name">{picked.name}</p></> : <p className="empty">아직 고른 곳이 없어요</p>}
        </div>
        <button id="go" ref={goRef} className="btn" hidden={!picked} onClick={() => nav("/plan?r=" + picked.id)}>여기로 1박 2일 일정 짜기</button>
        <button id="spin" className={picked ? "btn sub" : "btn"} hidden={mode !== "roulette"} disabled={busy || !data} onClick={spin}>{spun ? "다시 돌리기" : "룰렛 돌리기"}</button>
      </section>
    </Layout>
  );
}
