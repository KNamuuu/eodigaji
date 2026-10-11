import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import Layout from "../components/Layout.jsx";
import KoreaMap from "../components/KoreaMap.jsx";
import { Posts, withUrls, REASONS } from "../components/Record.jsx";
import { useRegions, bbox } from "../regions.js";
import { sb, useSession } from "../supabase.js";

// 지역을 꽉 채우는 viewBox. 아주 작은 곳(서울 구 등)은 최소 80칸
function zoom(r) {
  const [x, y, w, h] = bbox(r), s = Math.max(80, w * 1.6, h * 1.6);
  return `${x + (w - s) / 2} ${y + (h - s) / 2} ${s} ${s}`;
}

// D5 다른 사람 일정: 이 지역 공개 trip(내가 멤버인 건 빼고) → 펼치면 일정(읽기 전용) · [이 일정으로 짜기] = 내 trip으로 복사 · [신고]
// 작성자는 안 보여준다 (trip_people은 멤버만). 신고 3건이면 DB 트리거가 숨긴다
const byTime = (a, b) => (a.time || "99").localeCompare(b.time || "99");
function OtherTrips({ r, uid, mine }) {
  const go = useNavigate(), [list, setList] = useState(null), [open, setOpen] = useState(null), [rep, setRep] = useState(null), [err, setErr] = useState("");
  async function load() {
    const [{ data, error }, { data: reps }] = await Promise.all([
      sb.from("trips").select("id, title, tip, done_on, items(day, time, what)").eq("prov", r.prov).eq("place", r.name).eq("is_public", true).eq("hidden", false)
        .order("done_on", { ascending: false, nullsFirst: false }).limit(30), // ponytail: 최신 30개, 넘치면 더 보기
      sb.from("reports").select("trip_id").not("trip_id", "is", null)]);
    if (error) return setErr("불러오기 실패: " + error.message);
    const reported = new Set(reps?.map((x) => x.trip_id));
    setList(data.filter((t) => !mine.has(t.id)).map((t) => ({ ...t, reported: reported.has(t.id) })));
  }
  useEffect(() => { load(); }, [r, mine]);
  async function copy(t) {
    const id = crypto.randomUUID().replaceAll("-", "");
    const a = await sb.from("trips").insert({ id, owner_id: uid, prov: r.prov, place: r.name, title: t.title, tip: t.tip });
    const b = a.error || !t.items.length ? a : await sb.from("items").insert(t.items.map(({ day, time, what }) => ({ trip_id: id, day, time, what })));
    if (b.error) { if (!a.error) await sb.from("trips").delete().eq("id", id); return setErr("복사 실패: " + b.error.message); }
    go("/plan/" + id);
  }
  async function report(t, reason) {
    const { error } = await sb.from("reports").insert({ trip_id: t.id, reason });
    if (error && error.code !== "23505") return setErr("신고 실패: " + error.message);
    setRep(null); setErr(""); load();
  }
  if (!list) return err ? <p className="note">{err}</p> : <p className="help">불러오는 중…</p>;
  if (!list.length) return <p className="help">아직 이 지역에 공개된 일정이 없어요. 다녀온 여행에서 [일정 공개]를 켜면 여기 보여요.</p>;
  return <>
    {err && <p className="note" role="alert">{err}</p>}
    <ul className="trips others">{list.map((t) => {
      const days = Array.from({ length: Math.max(2, ...t.items.map((i) => i.day + 1)) }, (_, d) => t.items.filter((i) => i.day === d).sort(byTime));
      return <li key={t.id} data-trip={t.id}>
        <button type="button" aria-expanded={open === t.id} onClick={() => setOpen(open === t.id ? null : t.id)}>
          <b>{t.title || r.name}</b><small>{t.done_on ? `다녀옴 ${t.done_on} · ` : ""}일정 {t.items.length}개</small>
        </button>
        {open === t.id && <div className="ro">
          {days.map((d, i) => d.length > 0 && <section className="day" key={i}><h3>{i + 1}일차</h3>
            {d.map((it, k) => <p key={k}><b>{it.time}</b>{it.what}</p>)}
          </section>)}
          {t.tip && <p className="tip">{t.tip}</p>}
          <button className="btn copy" onClick={() => copy(t)}>이 일정으로 짜기</button>
          <div className="acts">{t.reported ? <small>신고했어요</small>
            : rep === t.id ? <span role="group" aria-label="신고 사유">
              {REASONS.map(([k, label]) => <button key={k} type="button" data-reason={k} onClick={() => report(t, k)}>{label}</button>)}
              <button type="button" onClick={() => setRep(null)}>취소</button>
            </span>
            : <button type="button" onClick={() => setRep(t.id)}>신고</button>}</div>
        </div>}
      </li>;
    })}</ul>
  </>;
}

// 지역 피드: 지도는 그 지역 확대, 패널은 탭 (내 기록 / 모두의 후기 / 다른 사람 일정) + 그 지역 내 여행
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
  useEffect(() => { if (uid && r && tab !== "trips") { setPosts(null); load(); } }, [uid, r, tab]);
  useEffect(() => {
    if (!uid || !r) return;
    sb.from("trips").select("id, title, place, status, done_on, trip_members!inner(user_id)").eq("prov", r.prov).eq("place", r.name).order("created_at", { ascending: false }).then(({ data }) => setTrips(data ?? []));
  }, [uid, r]);
  const mine = useMemo(() => trips && new Set(trips.map((t) => t.id)), [trips]);
  return (
    <Layout view="region" status={r && [r.name, r.prov + (posts ? ` · 기록 ${posts.length}개` : "")]} map={<KoreaMap data={data} picked={r} view={r && zoom(r)} />}>
      <section id="region" className="screen">
        <Link className="back" to="/me">← 내 지도</Link>
        <h2 className="title">{r?.name}</h2>
        <div className="tabs" role="tablist">
          {[["mine", "내 기록"], ["all", "모두의 후기"], ["trips", "다른 사람 일정"]].map(([m, label]) => (
            <button key={m} data-tab={m} className={tab === m ? "active" : undefined} role="tab" aria-selected={tab === m} onClick={() => setTab(m)}>{label}</button>
          ))}
        </div>
        {session === null ? <p className="help">로그인하면 이 지역 기록이 보여요. <Link to={`/login?next=/region/${id}`}>로그인</Link></p>
          : tab === "trips" ? mine && <OtherTrips r={r} uid={uid} mine={mine} />
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
