import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Layout from "../components/Layout.jsx";
import KoreaMap from "../components/KoreaMap.jsx";
import { useRegions } from "../regions.js";
import { sb, useSession } from "../supabase.js";

// 내 지도: 다녀온 곳 칠하기 + 내 여행 목록
// 칠한 곳: PC는 마우스 올리면, 폰은 첫 탭에, 키보드는 포커스에 미리보기(이름·날짜·대표사진) → 클릭·두 번째 탭·Enter로 지역 피드
export default function Me() {
  const data = useRegions(), session = useSession(), uid = session?.user.id, go = useNavigate();
  const [trips, setTrips] = useState(null), [err, setErr] = useState(""), [photo, setPhoto] = useState({}), [peek, setPeek] = useState(null);
  useEffect(() => {
    if (!uid) return;
    sb.from("trips").select("id, prov, place, title, shared, status, done_on, created_at").order("created_at", { ascending: false }) // RLS: 내가 멤버인 것만
      .then(({ data, error }) => { setTrips(data); setErr(error ? "불러오기 실패: " + error.message : ""); });
  }, [uid]);

  // 지역 index → { date: 가장 최근 다녀온 날, n: 다녀온 횟수, trips }
  const visited = useMemo(() => {
    const m = new Map();
    if (!data || !trips) return m;
    const idx = new Map(data.regions.map((r, i) => [r.prov + " " + r.name, i]));
    for (const t of trips) {
      const i = idx.get(t.prov + " " + t.place);
      if (t.status !== "done" || i === undefined) continue;
      const v = m.get(i) ?? { date: "", n: 0, trips: [] };
      v.n++; v.trips.push(t.id); if (t.done_on > v.date) v.date = t.done_on;
      m.set(i, v);
    }
    return m;
  }, [data, trips]);

  // 대표사진: 그 지역 기록 중 가장 최근 것의 첫 사진 (1시간 서명 URL)
  useEffect(() => {
    const ids = [...visited.values()].flatMap((v) => v.trips);
    if (!ids.length) return;
    sb.from("posts").select("trip_id, photos").in("trip_id", ids).neq("photos", "{}").order("created_at", { ascending: false }).then(async ({ data: posts }) => {
      const first = new Map();
      for (const [i, v] of visited) { const p = posts?.find((p) => v.trips.includes(p.trip_id)); if (p) first.set(i, p.photos[0]); }
      if (!first.size) return;
      const { data: signed } = await sb.storage.from("photos").createSignedUrls([...first.values()], 3600);
      const url = Object.fromEntries((signed ?? []).map((s) => [s.path, s.signedUrl]));
      setPhoto(Object.fromEntries([...first].map(([i, p]) => [i, url[p]])));
    });
  }, [visited]);

  const open = (r) => go("/region/" + r.id);
  const regionProps = (r, i) => {
    const v = visited.get(i);
    if (!v) return { onClick: () => setPeek(null) };
    return {
      tabIndex: 0, role: "link", "aria-label": `${r.prov} ${r.name} · 다녀옴 ${v.date}`,
      onPointerEnter: (e) => e.pointerType === "mouse" && setPeek(i),
      onPointerLeave: (e) => e.pointerType === "mouse" && setPeek(null),
      onFocus: (e) => e.target.matches(":focus-visible") && setPeek(i), onBlur: () => setPeek(null), // 키보드 포커스만 (터치 포커스까지 받으면 첫 탭에 바로 이동해버림)
      onClick: () => (peek === i ? open(r) : setPeek(i)), // 폰: 첫 탭 = 미리보기, 두 번째 탭 = 이동 (PC는 hover로 이미 열려 있어 바로 이동)
      onKeyDown: (e) => e.key === "Enter" && open(r),
    };
  };

  const r = peek !== null && data?.regions[peek], v = r && visited.get(peek);
  const status = v ? [r.name, <>{r.prov} · 다녀옴 {v.date}{v.n > 1 && ` · ${v.n}번`}{photo[peek] && <img src={photo[peek]} alt="" />}</>]
    : ["내 지도", trips && visited.size ? `${data?.regions.length ?? 167}곳 중 ${visited.size}곳 다녀왔어요` : "다녀온 곳이 여기 칠해져요"];

  return (
    <Layout view="me" status={status} map={<KoreaMap data={data} visited={new Set(visited.keys())} picked={r || null} regionProps={regionProps} />}>
      <section id="me" className="screen">
        <h2 className="title">내 여행</h2>
        {session === null ? <p className="help">로그인하면 저장한 여행이 여기 보여요. <Link to="/login?next=/me">로그인</Link></p>
          : err ? <p className="note">{err}</p>
          : !trips ? <p className="help">불러오는 중…</p>
          : !trips.length ? <p className="help">아직 저장한 여행이 없어요. <Link to="/">뽑으러 가기</Link></p>
          : <>
            {visited.size > 0 && <p className="help">칠해진 곳에 마우스를 올리거나 한 번 누르면 미리보기, 한 번 더 누르면 그 지역 기록으로 가요.</p>}
            <ul className="trips">{trips.map((t) => (
              <li key={t.id}><Link to={"/plan/" + t.id}><b>{t.title || t.place}</b><small>{t.prov} {t.place}{t.status === "done" ? ` · 다녀옴 ${t.done_on}` : t.shared ? " · 같이 고치는 중" : ""}</small></Link></li>
            ))}</ul>
          </>}
      </section>
    </Layout>
  );
}
