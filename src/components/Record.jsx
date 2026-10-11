import { useEffect, useState } from "react";
import { sb } from "../supabase.js";

// C1 다녀옴 + 기록: [다녀왔어요] → 날짜 · 사진 여러 장 · 한 줄 · 공개 여부 → 저장
// 사진은 올리기 전에 브라우저에서 긴 변 1600px로 줄여 다시 인코딩한다 → EXIF(GPS 등)도 같이 사라진다
// 저장: Storage photos/{내 id}/{기록 id}/{n}.webp → posts 행. 읽기 권한은 posts RLS를 따른다 (supabase/schema.sql)
const MAX = 1600, MAX_FILES = 10;
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);

async function shrink(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" }); // 세로 사진 회전은 EXIF대로 적용한 뒤 버린다
  const k = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  const enc = (type, q) => new Promise((ok) => c.toBlob(ok, type, q));
  const webp = await enc("image/webp", 0.8);
  return webp?.type === "image/webp" ? webp : enc("image/jpeg", 0.85); // Safari는 webp를 못 만들어 PNG를 준다 → JPEG로
}

export default function Record({ plan, uid, onChange }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(""), [err, setErr] = useState("");
  const [date, setDate] = useState(today()), [files, setFiles] = useState([]), [body, setBody] = useState(""), [pub, setPub] = useState(false);
  const [posts, setPosts] = useState(null);

  async function load() {
    const { data } = await sb.from("posts").select().eq("trip_id", plan.id).order("created_at", { ascending: false });
    const paths = (data ?? []).flatMap((p) => p.photos);
    const signed = paths.length ? (await sb.storage.from("photos").createSignedUrls(paths, 3600)).data ?? [] : [];
    const url = Object.fromEntries(signed.map((s) => [s.path, s.signedUrl]));
    setPosts((data ?? []).map((p) => ({ ...p, urls: p.photos.map((x) => url[x]).filter(Boolean) })));
  }
  useEffect(() => { load(); }, [plan.id]);

  async function submit(e) {
    e.preventDefault();
    setErr("");
    const id = crypto.randomUUID(), paths = [];
    try {
      if (plan.status !== "done") {
        setBusy("다녀옴 표시 중…");
        const { error } = await sb.from("trips").update({ status: "done", done_on: date }).eq("id", plan.id);
        if (error) throw error;
        onChange({ status: "done", done_on: date });
      }
      if (files.length || body.trim()) {
        for (const [i, f] of files.entries()) {
          setBusy(`사진 줄이는 중… ${i + 1}/${files.length}`);
          const blob = await shrink(f), path = `${uid}/${id}/${i}.${blob.type === "image/webp" ? "webp" : "jpg"}`;
          setBusy(`사진 올리는 중… ${i + 1}/${files.length}`);
          const { error } = await sb.storage.from("photos").upload(path, blob, { contentType: blob.type });
          if (error) throw error;
          paths.push(path);
        }
        const { error } = await sb.from("posts").insert({ id, trip_id: plan.id, prov: plan.prov, place: plan.place, body: body.trim(), photos: paths, is_public: pub });
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
      {!open ? (
        <button id="done" className="btn" onClick={() => setOpen(true)}>{done ? "+ 기록 남기기" : "다녀왔어요"}</button>
      ) : (
        <form id="recordForm" onSubmit={submit}>
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
      {posts?.length > 0 && (
        <ul className="posts">
          {posts.map((p) => (
            <li key={p.id}>
              {p.urls.length > 0 && <div className="photos">{p.urls.map((u, i) => <img key={i} src={u} alt="" loading="lazy" />)}</div>}
              {p.body && <p>{p.body}</p>}
              <small>{p.created_at.slice(0, 10)} · {p.is_public ? "공개" : "비공개"}{p.user_id !== uid ? " · 같이 간 사람" : ""}</small>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
