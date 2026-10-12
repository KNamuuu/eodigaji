import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { sb, useResign } from "../supabase.js";
import { Posts, withUrls, REASONS } from "./Record.jsx";

// 남의 공개 일정 하나 (읽기 전용): 일정 + 그 여행의 공개 기록(사진·후기) + [이 일정으로 짜기] · ♥ · 신고
// t = public_trips() 한 줄 (작성자 정보 없음). 지역 피드 [다른 사람 일정]에서 펼칠 때와 /plan/:id를 멤버 아닌 사람이 열 때 같이 쓴다
export const byTime = (a, b) => (a.time || "99").localeCompare(b.time || "99");
export const mapLink = (q) => "https://map.kakao.com/link/search/" + encodeURIComponent(q); // 카카오맵 검색 (폰이면 앱으로 열림)
export const MapPin = () => <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M12 21s-6-5.4-6-11a6 6 0 1 1 12 0c0 5.6-6 11-6 11Z" /><circle cx="12" cy="10" r="2" /></svg>;

export default function PublicTrip({ t, uid, reload }) {
  const go = useNavigate(), resign = useResign(), [posts, setPosts] = useState(null), [rep, setRep] = useState(false), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const loadPosts = async () => { const { data } = await sb.from("posts").select("*, trips(done_on)").eq("trip_id", t.id).order("created_at", { ascending: false }); setPosts(await withUrls(data)); };
  useEffect(() => { loadPosts(); }, [t.id, resign]);
  const days = Array.from({ length: Math.max(2, ...t.items.map((i) => i.day + 1)) }, (_, d) => t.items.filter((i) => i.day === d).sort(byTime));

  async function copy() {
    setBusy(true);
    const id = crypto.randomUUID().replaceAll("-", "");
    const a = await sb.from("trips").insert({ id, owner_id: uid, prov: t.prov, place: t.place, title: t.title, tip: t.tip, copied_from: t.id });
    const b = a.error || !t.items.length ? a : await sb.from("items").insert(t.items.map(({ day, time, what }) => ({ trip_id: id, day, time, what })));
    setBusy(false);
    if (b.error) { if (!a.error) await sb.from("trips").delete().eq("id", id); return setErr("복사 실패: " + b.error.message); }
    go("/plan/" + id);
  }
  async function like() {
    const q = t.liked ? sb.from("trip_likes").delete().eq("trip_id", t.id).eq("user_id", uid) : sb.from("trip_likes").insert({ trip_id: t.id });
    const { error } = await q;
    if (error && error.code !== "23505") return setErr("좋아요 실패: " + error.message);
    reload();
  }
  async function report(reason) {
    const { error } = await sb.from("reports").insert({ trip_id: t.id, reason });
    if (error && error.code !== "23505") return setErr("신고 실패: " + error.message);
    setRep(false); setErr(""); reload();
  }

  return (
    <div className="ro">
      {days.map((d, i) => d.length > 0 && <section className="day" key={i}><h3>{i + 1}일차</h3>
        {d.map((it, k) => <p key={k}><b>{it.time}</b><span>{it.what}</span>
          {it.what && <a className="maplink" href={mapLink(`${t.place} ${it.what}`)} target="_blank" rel="noopener" aria-label={`${it.what} 지도에서 찾기`}><MapPin /></a>}</p>)}
      </section>)}
      {t.tip && <p className="tip">{t.tip}</p>}
      <div className="pair">
        <button className="btn copy" disabled={busy} onClick={copy}>이 일정으로 짜기</button>
        <button className={"btn sub like" + (t.liked ? " on" : "")} aria-pressed={t.liked} onClick={like}>{t.liked ? "♥" : "♡"} {t.likes}</button>
      </div>
      {t.copies > 0 && <p className="help">{t.copies}명이 이 일정으로 따라 짰어요</p>}
      {err && <p className="note" role="alert">{err}</p>}
      {posts?.length > 0 && <><h3 className="sub-title">이 여행의 기록</h3><Posts posts={posts} uid={uid} reload={loadPosts} all /></>}
      <div className="acts">{t.reported ? <small>신고했어요</small>
        : rep ? <span role="group" aria-label="신고 사유">
          {REASONS.map(([k, label]) => <button key={k} type="button" data-reason={k} onClick={() => report(k)}>{label}</button>)}
          <button type="button" onClick={() => setRep(false)}>취소</button>
        </span>
        : <button type="button" onClick={() => setRep(true)}>일정 신고</button>}</div>
    </div>
  );
}
