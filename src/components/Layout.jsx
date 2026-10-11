import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { sb, useSession } from "../supabase.js";

// 오른쪽 위 프로필: 비로그인이면 [로그인], 로그인이면 사진·이름 + 로그아웃
function Who() {
  const session = useSession(), { pathname, search } = useLocation();
  if (session === undefined || pathname === "/login") return null;
  if (!session) return <Link className="who" to={"/login?next=" + encodeURIComponent(pathname + search)}>로그인</Link>;
  const m = session.user.user_metadata, name = m.name || m.full_name || m.nickname || session.user.email?.split("@")[0];
  return (
    <div className="who">
      {(m.avatar_url || m.picture) && <img src={m.avatar_url || m.picture} alt="" referrerPolicy="no-referrer" />}
      <span>{name}</span>
      <button onClick={() => sb.auth.signOut()}>로그아웃</button>
    </div>
  );
}

// 지도 | 패널 2단 (모바일은 지도 → 패널 1단). status = [큰 글씨, 작은 글씨]
export default function Layout({ view, map, status, children }) {
  useEffect(() => { scrollTo(0, 0); }, []);
  return (
    <div className="app" id="app" data-view={view}>
      <header className="brand"><h1><Link to="/">어디가지</Link></h1><p>전국 167곳 중 한 곳을 뽑아 1박 2일을 짜요</p><Who /></header>
      <main className="map-pane">
        {map}
        <div id="status" aria-live="polite">{status && <>{status[0]}<small>{status[1]}</small></>}</div>
      </main>
      <aside className="panel">{children}</aside>
    </div>
  );
}
