import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Layout from "../components/Layout.jsx";
import KoreaMap from "../components/KoreaMap.jsx";
import { Posts, withUrls } from "../components/Record.jsx";
import { useRegions, bbox } from "../regions.js";
import { sb, useSession } from "../supabase.js";

// 지역을 꽉 채우는 viewBox. 아주 작은 곳(서울 구 등)은 최소 80칸
function zoom(r) {
  const [x, y, w, h] = bbox(r), s = Math.max(80, w * 1.6, h * 1.6);
  return `${x + (w - s) / 2} ${y + (h - s) / 2} ${s} ${s}`;
}

// 지역 피드: 지도는 그 지역 확대, 패널은 탭 (내 기록 / 모두의 후기) + 그 지역 여행
// 모두의 후기 = 그 지역 공개 기록 최신순 (숨겨진 건 RLS가 빼고, 내 숨겨진 공개 기록은 여기서 뺀다). 남의 기록엔 신고
export default function Region() {
  const { id } = useParams(), data = useRegions(), session = useSession(), uid = session?.user.id, r = data?.regions.find((x) => String(x.id) === id);
  const [trips, setTrips] = useState(null), [posts, setPosts] = useState(null), [tab, setTab] = useState("mine");
  async function load() {
    let q = sb.from("posts").select("*, trips(done_on)").eq("prov", r.prov).eq("place", r.name).order("created_at", { ascending: false });
    q = tab === "mine" ? q.eq("user_id", uid) : q.eq("is_public", true).eq("hidden", false).limit(50); // ponytail: 최신 50개, 넘치면 더 보기
    const [{ data }, { data: mine }] = await Promise.all([q, tab === "all" ? sb.from("reports").select("post_id") : { data: [] }]);
    const reported = new Set(mine?.map((x) => x.post_id));
    setPosts((await withUrls(data)).map((p) => ({ ...p, reported: reported.has(p.id) })));
  }
  useEffect(() => { if (uid && r) { setPosts(null); load(); } }, [uid, r, tab]);
  useEffect(() => {
    if (!uid || !r) return;
    sb.from("trips").select("id, title, place, status, done_on").eq("prov", r.prov).eq("place", r.name).order("created_at", { ascending: false }).then(({ data }) => setTrips(data ?? []));
  }, [uid, r]);
  return (
    <Layout view="region" status={r && [r.name, r.prov + (posts ? ` · 기록 ${posts.length}개` : "")]} map={<KoreaMap data={data} picked={r} view={r && zoom(r)} />}>
      <section id="region" className="screen">
        <Link className="back" to="/me">← 내 지도</Link>
        <h2 className="title">{r?.name}</h2>
        <div className="tabs" role="tablist">
          {[["mine", "내 기록"], ["all", "모두의 후기"]].map(([m, label]) => (
            <button key={m} data-tab={m} className={tab === m ? "active" : undefined} role="tab" aria-selected={tab === m} onClick={() => setTab(m)}>{label}</button>
          ))}
        </div>
        {session === null ? <p className="help">로그인하면 이 지역 기록이 보여요. <Link to={`/login?next=/region/${id}`}>로그인</Link></p>
          : posts?.length === 0 ? <p className="help">{tab === "mine" ? "아직 이 지역 기록이 없어요. 아래 여행에서 [+ 기록 남기기]로 남겨요." : "아직 이 지역에 공개된 후기가 없어요."}</p>
          : <Posts posts={posts} uid={uid} reload={load} all={tab === "all"} />}
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
