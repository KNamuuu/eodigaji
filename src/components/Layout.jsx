import { useEffect } from "react";

// 지도 | 패널 2단 (모바일은 지도 → 패널 1단). status = [큰 글씨, 작은 글씨]
export default function Layout({ view, map, status, children }) {
  useEffect(() => { scrollTo(0, 0); }, []);
  return (
    <div className="app" id="app" data-view={view}>
      <header className="brand"><h1>어디가지</h1><p>전국 167곳 중 한 곳을 뽑아 1박 2일을 짜요</p></header>
      <main className="map-pane">
        {map}
        <div id="status" aria-live="polite">{status && <>{status[0]}<small>{status[1]}</small></>}</div>
      </main>
      <aside className="panel">{children}</aside>
    </div>
  );
}
