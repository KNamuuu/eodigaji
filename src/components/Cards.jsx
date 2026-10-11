import { useEffect, useRef, useState } from "react";

// ── 카드 3장: 섞기 → 펼치기 → 뒤집기(지도 깜빡) → 고르기. 움직임은 CSS(transform·opacity)만, 여기선 단계만 바꾼다 ──
const SHUFFLE_MS = 800;
const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// 앞면 지역 모양: path 크기에 맞춰 viewBox를 잡는다
const fit = (el) => { if (el) { const b = el.getBBox(); el.parentNode.setAttribute("viewBox", `${b.x} ${b.y} ${b.width} ${b.height}`); } };

export default function Cards({ data, out, pathsRef, setBusy, setStatus, onPick }) {
  const [deck, setDeck] = useState(null); // { cards: [region index], phase: 'shuffle'|'dealt', open: [bool], chosen }
  useEffect(() => setDeck(null), [out]); // 필터가 바뀌면 다시 뽑기
  const btnRef = useRef();
  const left = data.regions.length - out.size;

  function draw() {
    const pool = data.regions.map((_, i) => i).filter((i) => !out.has(i));
    const cards = [], n = Math.min(3, pool.length);
    while (cards.length < n) cards.push(...pool.splice(Math.floor(Math.random() * pool.length), 1));
    const skip = still();
    setDeck({ id: Date.now(), cards, phase: skip ? "dealt" : "shuffle", open: cards.map(() => false), chosen: null });
    onPick(null);
    setStatus([`${cards.length}장 중에 골라요`, "뒤집기 전엔 어딘지 몰라요"]);
    setTimeout(() => btnRef.current?.scrollIntoView({ behavior: skip ? "auto" : "smooth", block: "nearest" })); // 폰: 카드가 화면에 들어오게
    if (skip) return;
    setBusy(true);
    setTimeout(() => { setDeck((d) => d && { ...d, phase: "dealt" }); setBusy(false); }, SHUFFLE_MS);
  }

  function tap(k) {
    const i = deck.cards[k], r = data.regions[i];
    if (!deck.open[k]) {
      const open = deck.open.map((o, j) => o || j === k);
      setDeck({ ...deck, open });
      const p = pathsRef.current[i];
      p.classList.add("flash");
      setTimeout(() => p.classList.remove("flash"), 300); // 켜졌다가 .9초 동안 흐려짐
      return setStatus(open.every(Boolean) ? [r.name, "다 열었어요 · 갈 곳을 눌러 골라요"] : [r.name, r.prov]);
    }
    if (!deck.open.every(Boolean)) return;
    setDeck({ ...deck, chosen: k });
    onPick(r);
  }

  const all = deck?.open.every(Boolean);
  return <>
    {deck && (
      <div key={deck.id} className="deck" data-phase={deck.phase} data-chosen={deck.chosen != null || undefined}>
        {deck.cards.map((i, k) => {
          const r = data.regions[i], o = k - (deck.cards.length - 1) / 2;
          return (
            <button key={i} className="card" style={{ "--o": o, "--k": k }} disabled={deck.phase !== "dealt"}
              data-open={deck.open[k] || undefined} data-state={deck.chosen == null ? undefined : deck.chosen === k ? "chosen" : "dropped"}
              aria-label={!deck.open[k] ? `${k + 1}번 카드 뒤집기` : `${r.prov} ${r.name}${all ? " 고르기" : ""}`} onClick={() => tap(k)}>
              <span className="card-in">
                <span className="face back">
                  <svg viewBox="-12 -4 24 52" aria-hidden="true"><g transform="rotate(30 0 22)">
                    <path d="M0 29 L-8 39 L-7.5 44 L0 41Z M0 29 L5 38 L4.8 42.5 L0 41Z M-.8 21H.8V41H-.8Z M-2.6 9H2.6V22H-2.6Z M0 0 L1 9.5 L-1 9.5Z" />
                  </g></svg>
                </span>
                <span className="face front" aria-hidden="true">
                  <svg><path ref={fit} d={r.d} /></svg>
                  <b>{r.name}</b><small>{r.prov}</small>
                </span>
              </span>
            </button>
          );
        })}
      </div>
    )}
    <button id="draw" ref={btnRef} className={deck ? "btn sub" : "btn"} disabled={deck?.phase === "shuffle" || !left} onClick={draw}>{deck ? "다시 뽑기" : "카드 3장 뽑기"}</button>
  </>;
}
