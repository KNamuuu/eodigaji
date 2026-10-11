import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import Layout from "../components/Layout.jsx";
import KoreaMap from "../components/KoreaMap.jsx";
import Dart, { ZONE_H, DartGuide } from "../components/Dart.jsx";
import Cards from "../components/Cards.jsx";
import { useRegions } from "../regions.js";
import { sb, useSession } from "../supabase.js";

const HELP = {
  roulette: "버튼을 누르면 지도 위를 빠르게 돌다가 한 곳에 멈춰요.",
  cards: "카드 3장을 섞어 펼쳐요. 하나씩 뒤집어 보고 갈 곳을 골라요.",
  dart: "지도 어디서든 누른 채 아래로 당겼다 놓으면 다트가 날아가요. 많이 당길수록 멀리 가고, 바람만큼 밀려요.",
};
const pickedStatus = (r) => [r.name, `${r.prov} · 여기로 결정!`];
const idleStatus = ["어디로 갈까?", "버튼을 누르면 지도에 불이 들어와요"];

let saved = { mode: "roulette", picked: null, spun: false, provs: [], skipMine: false }; // 일정 보고 돌아와도 뽑은 곳 그대로

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
  // 필터: 고른 도만(비면 전국), 다녀온 곳 빼기(로그인 시)
  const [provs, setProvs] = useState(saved.provs), [skipMine, setSkipMine] = useState(saved.skipMine);
  const uid = useSession()?.user.id, [mine, setMine] = useState([]);
  useEffect(() => { saved = { mode, picked, spun, provs, skipMine }; });
  useEffect(() => {
    if (!uid) return setMine([]);
    sb.from("trips").select("prov, place").eq("status", "done").then(({ data }) => setMine(data || [])); // RLS: 내가 멤버인 것만
  }, [uid]);
  const out = useMemo(() => new Set(data?.regions.flatMap((r, i) =>
    (provs.length && !provs.includes(r.prov)) || (uid && skipMine && mine.some((t) => t.prov === r.prov && t.place === r.name)) ? [i] : [])), [data, provs, skipMine, mine, uid]);
  const outRef = useRef(out); outRef.current = out;
  const left = data ? data.regions.length - out.size : 0;
  const allProvs = useMemo(() => [...new Set(data?.regions.map((r) => r.prov))], [data]);
  useEffect(() => { if (data && picked && out.has(data.regions.indexOf(picked))) { setPicked(null); setStatus(idleStatus); } }, [out]);

  function choose(r) {
    setPicked(r);
    if (!r) return;
    setStatus(pickedStatus(r));
    setTimeout(() => goRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
  }
  function setMode(m) {
    setModeState(m); setPicked(null); setRound((n) => n + 1);
    if (m !== "dart") setStatus(m === "cards" ? ["3장 중에 골라요", "뒤집기 전엔 어딘지 몰라요"] : idleStatus);
  }

  // ── 지도 룰렛: 빠르게 깜빡이다 점점 느려지며 멈춤 ──
  function spin() {
    const regions = data.regions, paths = pathsRef.current;
    const pool = regions.map((_, i) => i).filter((i) => !out.has(i));
    setBusy(true); setPicked(null);
    let delay = 30, last = -1;
    const step = () => {
      let i;
      do i = pool[Math.floor(Math.random() * pool.length)]; while (i === last && pool.length > 1);
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
    <KoreaMap data={data} height={data && (mode === "dart" ? data.h + ZONE_H : data.h)} picked={picked} out={out} svgRef={svgRef} pathsRef={pathsRef}>
      {data && mode === "dart" && <Dart key={round} svgRef={svgRef} pathsRef={pathsRef} data={data} setBusy={setBusy} setStatus={setStatus} onPick={choose} outRef={outRef} />}
    </KoreaMap>
  );
  return (
    <Layout view="home" map={map} status={status}>
      <section id="home" className="screen">
        <div className="tabs" role="tablist">
          {[["roulette", "지도 룰렛"], ["dart", "다트"], ["cards", "카드"]].map(([m, label]) => (
            <button key={m} data-mode={m} className={mode === m ? "active" : undefined} role="tab" onClick={() => !busy && setMode(m)}>{label}</button>
          ))}
        </div>
        <details className="filter">
          <summary>{provs.length || (uid && skipMine) ? `필터 · ${left}곳에서 뽑아요` : `필터 · 전국 ${left}곳`}</summary>
          <div className="chips">
            {allProvs.map((p) => (
              <button key={p} aria-pressed={provs.includes(p)} disabled={busy}
                onClick={() => setProvs(provs.includes(p) ? provs.filter((x) => x !== p) : [...provs, p])}>{p}</button>
            ))}
          </div>
          {uid ? <label className="check"><input type="checkbox" checked={skipMine} disabled={busy} onChange={(e) => setSkipMine(e.target.checked)} /> 다녀온 곳 빼기</label>
            : <p className="note">로그인하면 다녀온 곳을 뺄 수 있어요</p>}
          {provs.length > 0 && <button className="add" disabled={busy} onClick={() => setProvs([])}>도 선택 지우기</button>}
        </details>
        <p className="help desk" id="help">{HELP[mode]}</p>
        <div className="result desk" id="result">
          {picked ? <><p className="prov">{picked.prov}</p><p className="name">{picked.name}</p></> : <p className="empty">아직 고른 곳이 없어요</p>}
        </div>
        {mode === "dart" && <DartGuide />}
        {data && mode === "cards" && <Cards key={round} data={data} out={out} pathsRef={pathsRef} setBusy={setBusy} setStatus={setStatus} onPick={choose} />}
        <button id="go" ref={goRef} className="btn" hidden={!picked} onClick={() => nav("/plan?r=" + picked.id)}>여기로 1박 2일 일정 짜기</button>
        <button id="spin" className={picked ? "btn sub" : "btn"} hidden={mode !== "roulette"} disabled={busy || !left} onClick={spin}>{spun ? "다시 돌리기" : "룰렛 돌리기"}</button>
        {data && !left && <p className="note">남은 곳이 없어요. 필터를 풀어주세요</p>}
      </section>
    </Layout>
  );
}
