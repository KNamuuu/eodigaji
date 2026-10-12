import { useEffect, useRef, useState } from "react";
import { sb, useResign } from "../supabase.js";
import { thumbOf } from "../regions.js";

// C1 다녀옴 + 기록: [다녀왔어요] → 날짜 · 사진 여러 장 · 한 줄 · 공개 여부 → 저장
// D5 일정 공개(trips.is_public): 다녀옴 저장할 때 같이 묻고, 그 뒤엔 토글. 공개하면 그 지역 "다른 사람 일정"에 이름 없이 보임
// 사진은 올리기 전에 브라우저에서 긴 변 1600px로 줄여 다시 인코딩한다 → EXIF(GPS 등)도 같이 사라진다
// 저장: Storage photos/{내 id}/{기록 id}/{n}.webp + 지도용 썸네일 t{n}.webp(긴 변 400px) → posts 행. 읽기 권한은 posts RLS를 따른다 (supabase/schema.sql)
const MAX = 1600, THUMB = 400, MAX_FILES = 10;
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);

export async function shrink(file, max = MAX) {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" }); // 세로 사진 회전은 EXIF대로 적용한 뒤 버린다
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  const enc = (type, q) => new Promise((ok) => c.toBlob(ok, type, q));
  const webp = await enc("image/webp", 0.8);
  return webp?.type === "image/webp" ? webp : enc("image/jpeg", 0.85); // Safari는 webp를 못 만들어 PNG를 준다 → JPEG로
}

// 기록마다 사진 서명 URL(1시간)을 붙인다: urls = 원본(크게 볼 때), thumbs = 썸네일(격자). D4 전 사진은 썸네일이 없을 수 있어 원본으로
export async function withUrls(posts) {
  const paths = (posts ?? []).flatMap((p) => p.photos), all = [...paths, ...paths.map(thumbOf)];
  const signed = paths.length ? (await sb.storage.from("photos").createSignedUrls(all, 3600)).data ?? [] : [];
  const url = Object.fromEntries(signed.filter((s) => s.signedUrl).map((s) => [s.path, s.signedUrl]));
  return (posts ?? []).map((p) => {
    const ok = p.photos.filter((x) => url[x]);
    return { ...p, urls: ok.map((x) => url[x]), thumbs: ok.map((x) => url[thumbOf(x)] ?? url[x]), shown: ok };
  });
}

export const REASONS = [["spam", "광고·도배"], ["abuse", "욕설·불쾌"], ["privacy", "개인정보 노출"], ["etc", "기타"]];

// 기록 목록 (C3): 사진 2열 격자 → 누르면 크게(<dialog>), 내 기록은 수정(한 줄·공개)·삭제
// all(D1 모두의 후기): 남의 기록엔 [신고] → 사유 고르기. 3명이 신고하면 DB 트리거가 숨긴다
export function Posts({ posts, uid, reload, all }) {
  const big = useRef(), [src, setSrc] = useState(null), [edit, setEdit] = useState(null), [err, setErr] = useState(""), [rep, setRep] = useState(null);
  async function report(p, reason) {
    const { error } = await sb.from("reports").insert({ post_id: p.id, reason });
    if (error && error.code !== "23505") return setErr("신고 실패: " + error.message); // 23505 = 이미 신고함
    setRep(null); setErr(""); reload();
  }
  const show = (u, path, p) => { setSrc({ u, path, trip: (!all || p.user_id === uid) && p.trip_id, done: false }); big.current.showModal(); };
  // 대표사진: 그 여행(trips.cover)에 저장 → 내 지도에서 그 지역을 이 사진으로 채움. 같은 여행 멤버 지도에도 같이 적용
  async function cover(e) {
    e.stopPropagation();
    const { error } = await sb.from("trips").update({ cover: src.path }).eq("id", src.trip);
    if (error) return setErr("대표사진 저장 실패: " + error.message);
    setSrc({ ...src, done: true });
  }
  async function save(e) {
    e.preventDefault();
    const { error } = await sb.from("posts").update({ body: edit.body.trim(), is_public: edit.is_public }).eq("id", edit.id);
    if (error) return setErr("수정 실패: " + error.message);
    setEdit(null); setErr(""); reload();
  }
  async function del(p) {
    if (!confirm("이 기록을 지울까요? 사진도 같이 지워져요.")) return;
    const { error } = await sb.from("posts").delete().eq("id", p.id);
    if (error) return setErr("삭제 실패: " + error.message);
    if (p.photos.length) await sb.storage.from("photos").remove([...p.photos, ...p.photos.map(thumbOf)]);
    setErr(""); reload();
  }
  if (!posts?.length) return null;
  return (
    <>
      {err && <p className="note" role="alert">{err}</p>}
      <ul className="posts">
        {posts.map((p) => (
          <li key={p.id} data-post={p.id}>
            {p.urls.length > 0 && <div className="photos">{p.urls.map((u, i) => (
              <button key={i} type="button" onClick={() => show(u, p.shown[i], p)} aria-label={`사진 ${i + 1} 크게 보기`}><img src={p.thumbs[i]} alt="" loading="lazy" /></button>
            ))}</div>}
            {edit?.id === p.id ? (
              <form className="edit" onSubmit={save}>
                <input aria-label="한 줄" maxLength={500} value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} />
                <label className="check"><input type="checkbox" checked={edit.is_public} onChange={(e) => setEdit({ ...edit, is_public: e.target.checked })} />모두에게 공개</label>
                <div className="pair"><button className="btn">저장</button><button type="button" className="btn sub" onClick={() => setEdit(null)}>취소</button></div>
              </form>
            ) : <>
              {p.body && <p>{p.body}</p>}
              <small>{p.trips?.done_on ?? p.created_at.slice(0, 10)} · {p.is_public ? "공개" : "비공개"}{p.user_id === uid ? (p.hidden ? " · 신고로 숨겨짐" : "") : all ? " · 다른 사람" : " · 같이 간 사람"}</small>
              {p.user_id === uid && <div className="acts">
                <button type="button" onClick={() => setEdit({ id: p.id, body: p.body ?? "", is_public: p.is_public })}>수정</button>
                <button type="button" onClick={() => del(p)}>삭제</button>
              </div>}
              {all && p.user_id !== uid && (p.reported ? <small>신고했어요</small>
                : rep === p.id ? <div className="acts" role="group" aria-label="신고 사유">
                  {REASONS.map(([k, label]) => <button key={k} type="button" data-reason={k} onClick={() => report(p, k)}>{label}</button>)}
                  <button type="button" onClick={() => setRep(null)}>취소</button>
                </div>
                : <div className="acts"><button type="button" onClick={() => setRep(p.id)}>신고</button></div>)}
            </>}
          </li>
        ))}
      </ul>
      <dialog ref={big} className="big" onClick={() => big.current.close()} aria-label="사진 크게 보기">
        <img src={src?.u} alt="" />
        {src?.trip && <button type="button" className="btn cover" disabled={src.done} onClick={cover}>{src.done ? "대표사진으로 정했어요" : "대표사진으로"}</button>}
      </dialog>
    </>
  );
}

export default function Record({ plan, uid, onChange }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(""), [err, setErr] = useState("");
  const [date, setDate] = useState(today()), [files, setFiles] = useState([]), [body, setBody] = useState(""), [pub, setPub] = useState(false);
  const [posts, setPosts] = useState(null), [share, setShare] = useState(false);
  async function setPublic(v) { // 바로 바꾸고, 실패하면 되돌림
    onChange({ is_public: v }); setErr("");
    const { error } = await sb.from("trips").update({ is_public: v }).eq("id", plan.id);
    if (error) { onChange({ is_public: !v }); setErr("공개 설정 실패: " + error.message); }
  }

  async function load() {
    const { data } = await sb.from("posts").select().eq("trip_id", plan.id).order("created_at", { ascending: false });
    setPosts(await withUrls(data));
  }
  const resign = useResign();
  useEffect(() => { load(); }, [plan.id, resign]);

  async function submit(e) {
    e.preventDefault();
    setErr("");
    const id = crypto.randomUUID(), paths = [];
    try {
      if (plan.status !== "done") {
        setBusy("다녀옴 표시 중…");
        const { error } = await sb.from("trips").update({ status: "done", done_on: date, is_public: share }).eq("id", plan.id);
        if (error) throw error;
        onChange({ status: "done", done_on: date, is_public: share });
      }
      if (files.length || body.trim()) {
        for (const [i, f] of files.entries()) {
          setBusy(`사진 줄이는 중… ${i + 1}/${files.length}`);
          const blob = await shrink(f), thumb = await shrink(f, THUMB), path = `${uid}/${id}/${i}.${blob.type === "image/webp" ? "webp" : "jpg"}`;
          setBusy(`사진 올리는 중… ${i + 1}/${files.length}`);
          for (const [p, b] of [[path, blob], [thumbOf(path), thumb]]) {
            const { error } = await sb.storage.from("photos").upload(p, b, { contentType: b.type });
            if (error) throw error;
            paths.push(p);
          }
        }
        const { error } = await sb.from("posts").insert({ id, trip_id: plan.id, prov: plan.prov, place: plan.place, body: body.trim(), photos: paths.filter((_, i) => i % 2 === 0), is_public: pub });
        if (error) throw error;
      }
      setOpen(false); setFiles([]); setBody(""); setPub(false);
      await load();
    } catch (x) {
      if (paths.length) sb.storage.from("photos").remove(paths); // 반쯤 올라간 사진은 지운다
      setErr("저장 실패: " + (x.message || x));
    } finally { setBusy(""); }
  }

  const done = plan.status === "done";
  return (
    <section className="record" aria-label="다녀온 기록">
      {done && <p className="note">다녀옴 · {plan.done_on}</p>}
      {done && <label className="check" id="tripPublic"><input type="checkbox" checked={!!plan.is_public} onChange={(e) => setPublic(e.target.checked)} />일정 공개 (이 지역에서 다른 사람이 이름 없이 볼 수 있어요)</label>}
      {!open && err && <p className="note" role="alert">{err}</p>}
      {!open ? (
        <button id="done" className="btn" onClick={() => setOpen(true)}>{done ? "+ 기록 남기기" : "다녀왔어요"}</button>
      ) : (
        <form id="recordForm" onSubmit={submit}>
          {!done && <label className="check"><input type="checkbox" name="tripPublic" checked={share} onChange={(e) => setShare(e.target.checked)} />이 일정도 공개 (다른 사람이 보고 따라 짤 수 있어요)</label>}
          {!done && <label>다녀온 날<input type="date" name="date" required max={today()} value={date} onChange={(e) => setDate(e.target.value)} /></label>}
          <label>사진 (최대 {MAX_FILES}장)
            <input type="file" name="photos" accept="image/*" multiple
              onChange={(e) => { const f = [...e.target.files]; setErr(f.length > MAX_FILES ? `사진은 ${MAX_FILES}장까지예요` : ""); setFiles(f.slice(0, MAX_FILES)); }} />
          </label>
          <label>한 줄<input name="body" maxLength={500} placeholder="어땠어요?" value={body} onChange={(e) => setBody(e.target.value)} /></label>
          <label className="check"><input type="checkbox" name="public" checked={pub} onChange={(e) => setPub(e.target.checked)} />모두에게 공개 (끄면 같이 간 사람만)</label>
          <p className="help">사진은 올리기 전에 줄이고, 위치(GPS) 같은 촬영 정보는 지워져요.</p>
          {err && <p className="note" role="alert">{err}</p>}
          <button className="btn" disabled={!!busy}>{busy || (done ? "기록 저장" : "다녀옴 저장")}</button>
          <button type="button" className="btn sub" disabled={!!busy} onClick={() => setOpen(false)}>취소</button>
        </form>
      )}
      <Posts posts={posts} uid={uid} reload={load} />
    </section>
  );
}
