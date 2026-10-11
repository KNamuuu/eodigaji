import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Layout from "../components/Layout.jsx";
import KoreaMap from "../components/KoreaMap.jsx";
import { useRegions } from "../regions.js";
import { sb, useSession } from "../supabase.js";

// 지역 피드 자리: 지금은 그 지역 내 여행 목록만 (사진·글 피드는 C3)
export default function Region() {
  const { id } = useParams(), data = useRegions(), uid = useSession()?.user.id, r = data?.regions.find((x) => String(x.id) === id);
  const [trips, setTrips] = useState(null);
  useEffect(() => {
    if (!uid || !r) return;
    sb.from("trips").select("id, title, place, status, done_on").eq("prov", r.prov).eq("place", r.name).order("created_at", { ascending: false }).then(({ data }) => setTrips(data ?? []));
  }, [uid, r]);
  return (
    <Layout view="region" status={r && [r.name, r.prov]} map={<KoreaMap data={data} picked={r} />}>
      <section className="screen">
        <Link className="back" to="/me">← 내 지도</Link>
        <h2 className="title">{r?.name}</h2>
        <ul className="trips">{trips?.map((t) => (
          <li key={t.id}><Link to={"/plan/" + t.id}><b>{t.title || t.place}</b><small>{t.status === "done" ? `다녀옴 ${t.done_on}` : "계획 중"}</small></Link></li>
        ))}</ul>
      </section>
    </Layout>
  );
}
