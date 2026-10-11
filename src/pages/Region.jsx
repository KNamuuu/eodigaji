import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Layout from "../components/Layout.jsx";
import KoreaMap from "../components/KoreaMap.jsx";
import { Posts, withUrls } from "../components/Record.jsx";
import { useRegions } from "../regions.js";
import { sb, useSession } from "../supabase.js";

// 지역을 꽉 채우는 viewBox: path가 M·L·Z 절대좌표뿐이라 숫자 쌍의 최소·최대로 충분. 아주 작은 곳(서울 구 등)은 최소 80칸
function zoom(d) {
  const n = d.match(/-?[\d.]+/g).map(Number), xs = n.filter((_, i) => i % 2 === 0), ys = n.filter((_, i) => i % 2);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const s = Math.max(80, (x1 - x0) * 1.6, (y1 - y0) * 1.6);
  return `${(x0 + x1 - s) / 2} ${(y0 + y1 - s) / 2} ${s} ${s}`;
}

// 지역 피드 (내 기록): 지도는 그 지역 확대, 패널은 내가 쓴 그 지역 기록 (사진 격자 · 한 줄 · 다녀온 날) + 그 지역 여행
export default function Region() {
  const { id } = useParams(), data = useRegions(), session = useSession(), uid = session?.user.id, r = data?.regions.find((x) => String(x.id) === id);
  const [trips, setTrips] = useState(null), [posts, setPosts] = useState(null);
  async function load() {
    const { data } = await sb.from("posts").select("*, trips(done_on)").eq("user_id", uid).eq("prov", r.prov).eq("place", r.name).order("created_at", { ascending: false });
    setPosts(await withUrls(data));
  }
  useEffect(() => {
    if (!uid || !r) return;
    load();
    sb.from("trips").select("id, title, place, status, done_on").eq("prov", r.prov).eq("place", r.name).order("created_at", { ascending: false }).then(({ data }) => setTrips(data ?? []));
  }, [uid, r]);
  return (
    <Layout view="region" status={r && [r.name, r.prov + (posts ? ` · 기록 ${posts.length}개` : "")]} map={<KoreaMap data={data} picked={r} view={r && zoom(r.d)} />}>
      <section id="region" className="screen">
        <Link className="back" to="/me">← 내 지도</Link>
        <h2 className="title">{r?.name}</h2>
        {session === null ? <p className="help">로그인하면 이 지역 기록이 보여요. <Link to={`/login?next=/region/${id}`}>로그인</Link></p>
          : posts?.length === 0 ? <p className="help">아직 이 지역 기록이 없어요. 아래 여행에서 [+ 기록 남기기]로 남겨요.</p>
          : <Posts posts={posts} uid={uid} reload={load} />}
        {trips?.length > 0 && <>
          <h3 className="sub-title">이 지역 여행</h3>
          <ul className="trips">{trips.map((t) => (
            <li key={t.id}><Link to={"/plan/" + t.id}><b>{t.title || t.place}</b><small>{t.status === "done" ? `다녀옴 ${t.done_on}` : "계획 중"}</small></Link></li>
          ))}</ul>
        </>}
      </section>
    </Layout>
  );
}
