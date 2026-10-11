import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Layout from "../components/Layout.jsx";
import KoreaMap from "../components/KoreaMap.jsx";
import { useRegions } from "../regions.js";
import { sb, useSession } from "../supabase.js";

// 내 지도: 내 여행 목록 (색칠은 C2에서)
export default function Me() {
  const data = useRegions(), session = useSession(), uid = session?.user.id;
  const [trips, setTrips] = useState(null), [err, setErr] = useState("");
  useEffect(() => {
    if (!uid) return;
    sb.from("trips").select("id, prov, place, title, shared, created_at").order("created_at", { ascending: false }) // RLS: 내가 멤버인 것만
      .then(({ data, error }) => { setTrips(data); setErr(error ? "불러오기 실패: " + error.message : ""); });
  }, [uid]);

  return (
    <Layout view="me" status={["내 지도", "다녀온 곳이 여기 칠해질 거예요"]} map={<KoreaMap data={data} />}>
      <section id="me" className="screen">
        <h2 className="title">내 여행</h2>
        {session === null ? <p className="help">로그인하면 저장한 여행이 여기 보여요. <Link to="/login?next=/me">로그인</Link></p>
          : err ? <p className="note">{err}</p>
          : !trips ? <p className="help">불러오는 중…</p>
          : !trips.length ? <p className="help">아직 저장한 여행이 없어요. <Link to="/">뽑으러 가기</Link></p>
          : <ul className="trips">{trips.map((t) => (
              <li key={t.id}><Link to={"/plan/" + t.id}><b>{t.title || t.place}</b><small>{t.prov} {t.place}{t.shared ? " · 같이 고치는 중" : ""}</small></Link></li>
            ))}</ul>}
      </section>
    </Layout>
  );
}
