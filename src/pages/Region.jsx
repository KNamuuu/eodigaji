import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Layout from "../components/Layout.jsx";
import KoreaMap, { usePanZoom, ZoomButtons } from "../components/KoreaMap.jsx";
import { Posts, withUrls } from "../components/Record.jsx";
import PublicTrip from "../components/PublicTrip.jsx";
import { useRegions, bbox } from "../regions.js";
import { sb, useSession, useResign } from "../supabase.js";

const PAGE = 30;

// 지역을 꽉 채우는 viewBox. 아주 작은 곳(서울 구 등)은 최소 80칸
function zoom(r) {
  const [x, y, w, h] = bbox(r), s = Math.max(80, w * 1.6, h * 1.6);
  return `${x + (w - s) / 2} ${y + (h - s) / 2} ${s} ${s}`;
}

// D5 다른 사람 일정: 이 지역 공개 trip(내가 멤버인 건 빼고, 작성자 정보 없이 public_trips RPC) → 인기순(♥ + 따라 짬)·최신순 → 펼치면 PublicTrip
function OtherTrips({ r, uid }) {
  const [list, setList] = useState(null), [open, setOpen] = useState(null), [err, setErr] = useState(""), [sort, setSort] = useState("hot"), [n, setN] = useState(PAGE);
  async function load() {
    const [{ data, error }, { data: reps }] = await Promise.all([
      sb.rpc("public_trips", { p_prov: r.prov, p_place: r.name, sort, lim: n }), // ponytail: [더 보기]는 n을 늘려 처음부터 다시 받음. 수백 개 되면 커서로
      sb.from("reports").select("trip_id").not("trip_id", "is", null)]);
    if (error) return setErr("불러오기 실패: " + error.message);
    const reported = new Set(reps?.map((x) => x.trip_id));
    setList(data.map((t) => ({ ...t, reported: reported.has(t.id) })));
  }
  useEffect(() => { load(); }, [r, sort, n]);
  if (!list) return err ? <p className="note">{err}</p> : <p className="help">불러오는 중…</p>;
  if (!list.length) return <p className="help">아직 이 지역에 공개된 일정이 없어요. 다녀온 여행에서 [일정 공개]를 켜면 여기 보여요.</p>;
  return <>
    {err && <p className="note" role="alert">{err}</p>}
    <div className="sort" role="group" aria-label="정렬">{[["hot", "인기순"], ["new", "최신순"]].map(([k, label]) => <button key={k} type="button" aria-pressed={sort === k} onClick={() => setSort(k)}>{label}</button>)}</div>
    <ul className="trips others">{list.map((t) => (
      <li key={t.id} data-trip={t.id}>
        <button type="button" aria-expanded={open === t.id} onClick={() => setOpen(open === t.id ? null : t.id)}>
          <b>{t.title || r.name}</b><small>{t.done_on ? `다녀옴 ${t.done_on} · ` : ""}일정 {t.items.length}개 · ♥ {t.likes}{t.copies ? ` · ${t.copies}명 따라 짬` : ""}</small>
        </button>
        {open === t.id && <PublicTrip t={t} uid={uid} reload={load} />}
      </li>
    ))}</ul>
    {list.length === n && <button className="btn sub more" onClick={() => setN(n + PAGE)}>더 보기</button>}
  </>;
}

// 지역 피드: 지도는 그 지역 확대, 패널은 탭 (내 기록 / 모두의 후기 / 다른 사람 일정) + 그 지역 내 여행
// 모두의 후기 = 그 지역 공개 기록 최신순 (숨겨진 건 RLS가 빼고, 내 숨겨진 공개 기록은 여기서 뺀다). 남의 기록엔 신고
export default function Region() {
  const { id } = useParams(), data = useRegions(), session = useSession(), uid = session?.user.id, r = data?.regions.find((x) => String(x.id) === id);
  const [trips, setTrips] = useState(null), [posts, setPosts] = useState(null), [tab, setTab] = useState("mine"), [n, setN] = useState(PAGE), resign = useResign();
  const svg = useRef(), pz = usePanZoom(svg, data?.w, data?.h, r && zoom(r));
  async function load() {
    let q = sb.from("posts").select("*, trips(done_on)").eq("prov", r.prov).eq("place", r.name).order("created_at", { ascending: false });
    q = (tab === "mine" ? q.eq("user_id", uid) : q.eq("is_public", true).eq("hidden", false)).limit(n); // ponytail: [더 보기]는 n을 늘려 처음부터 다시 받음
    const [{ data }, { data: mine }] = await Promise.all([q, tab === "all" ? sb.from("reports").select("post_id") : { data: [] }]);
    const reported = new Set(mine?.map((x) => x.post_id));
    setPosts((await withUrls(data)).map((p) => ({ ...p, reported: reported.has(p.id) })));
  }
  useEffect(() => { setN(PAGE); }, [r, tab]);
  useEffect(() => { if (uid && r && tab !== "trips") load(); }, [uid, r, tab, n, resign]);
  useEffect(() => { setPosts(null); }, [r, tab]);
  useEffect(() => {
    if (!uid || !r) return;
    sb.from("trips").select("id, title, place, status, done_on, trip_members!inner(user_id)").eq("prov", r.prov).eq("place", r.name).order("created_at", { ascending: false }).then(({ data }) => setTrips(data ?? []));
  }, [uid, r]);
  return (
    <Layout view="region" status={r && [r.name, r.prov + (posts ? ` · 기록 ${posts.length}개` : "")]} map={<>
      <KoreaMap data={data} picked={r} view={r && pz.view} svgRef={svg} />
      {r && <ZoomButtons pz={pz} label="다시 맞추기" />}
    </>}>
      <section id="region" className="screen">
        <Link className="back" to="/me">← 내 지도</Link>
        <h2 className="title">{r?.name}</h2>
        <div className="tabs" role="tablist">
          {[["mine", "내 기록"], ["all", "모두의 후기"], ["trips", "다른 사람 일정"]].map(([m, label]) => (
            <button key={m} data-tab={m} className={tab === m ? "active" : undefined} role="tab" aria-selected={tab === m} onClick={() => setTab(m)}>{label}</button>
          ))}
        </div>
        {session === null ? <p className="help">로그인하면 이 지역 기록이 보여요. <Link to={`/login?next=/region/${id}`}>로그인</Link></p>
          : tab === "trips" ? <OtherTrips r={r} uid={uid} />
          : posts?.length === 0 ? <p className="help">{tab === "mine" ? "아직 이 지역 기록이 없어요. 아래 여행에서 [+ 기록 남기기]로 남겨요." : "아직 이 지역에 공개된 후기가 없어요."}</p>
          : <>
            <Posts posts={posts} uid={uid} reload={load} all={tab === "all"} />
            {posts?.length === n && <button className="btn sub more" onClick={() => setN(n + PAGE)}>더 보기</button>}
          </>}
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
