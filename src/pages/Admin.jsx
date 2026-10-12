import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Layout from "../components/Layout.jsx";
import KoreaMap from "../components/KoreaMap.jsx";
import { useRegions, thumbOf } from "../regions.js";
import { sb, useSession, useResign } from "../supabase.js";

// 신고 관리 (/admin): public.admins에 든 계정만. 신고 들어온 기록·일정을 최근 순으로 → [되살리기](숨김 풀고 신고 지움) · [지우기]
// 기록 지우기 = 사진(원본·썸네일)을 Storage에서 먼저 지우고 행 삭제. 일정 지우기 = 남의 일정 자체는 두고 공개만 내림
const REASON = { spam: "광고·도배", abuse: "욕설·불쾌", privacy: "개인정보 노출", etc: "기타" };

export default function Admin() {
  const data = useRegions(), session = useSession(), resign = useResign();
  const [rows, setRows] = useState(null), [err, setErr] = useState(""), [urls, setUrls] = useState({});
  async function load() {
    const { data: r, error } = await sb.rpc("admin_reports");
    if (error) return setErr(error.message.includes("admin only") ? "관리자만 볼 수 있어요." : "불러오기 실패: " + error.message);
    setRows(r);
    const paths = r.flatMap((x) => x.photos.map(thumbOf));
    if (paths.length) setUrls(Object.fromEntries(((await sb.storage.from("photos").createSignedUrls(paths, 3600)).data ?? []).map((s) => [s.path, s.signedUrl])));
  }
  useEffect(() => { if (session) load(); }, [session, resign]);
  async function act(x, action) {
    if (action === "delete" && !confirm(x.kind === "post" ? "이 기록과 사진을 지울까요?" : "이 일정을 비공개로 내릴까요?")) return;
    if (action === "delete" && x.photos.length) {
      const { error } = await sb.storage.from("photos").remove([...x.photos, ...x.photos.map(thumbOf)]);
      if (error) return setErr("사진 삭제 실패: " + error.message);
    }
    const { error } = await sb.rpc("admin_resolve", { kind: x.kind, tid: x.id, action });
    if (error) return setErr("처리 실패: " + error.message);
    setErr(""); load();
  }
  return (
    <Layout view="admin" map={<KoreaMap data={data} />} status={["신고 관리", rows ? `${rows.length}건` : ""]}>
      <section id="admin" className="screen">
        <Link className="back" to="/me">← 내 지도</Link>
        <h2 className="title">신고 관리</h2>
        {session === null ? <p className="help"><Link to="/login?next=/admin">로그인</Link></p>
          : err ? <p className="note" role="alert">{err}</p>
          : !rows ? <p className="help">불러오는 중…</p>
          : !rows.length ? <p className="help">들어온 신고가 없어요.</p>
          : <ul className="posts">{rows.map((x) => (
            <li key={x.kind + x.id} data-report={x.id}>
              <small>{x.kind === "post" ? "기록" : "일정"} · {x.prov} {x.place} · 신고 {x.n}건{x.hidden ? " · 숨겨짐" : ""} · {x.last.slice(0, 10)}</small>
              {x.photos.length > 0 && <div className="photos">{x.photos.map((p) => urls[thumbOf(p)] && <img key={p} src={urls[thumbOf(p)]} alt="" />)}</div>}
              <p>{x.kind === "post" ? x.body || "(글 없음)" : <Link to={"/plan/" + x.id}>{x.title || "(제목 없음)"}</Link>}</p>
              <small>사유: {[...new Set(x.reasons)].map((r) => REASON[r] ?? r).join(", ")}</small>
              <div className="acts">
                <button type="button" onClick={() => act(x, "restore")}>되살리기</button>
                <button type="button" onClick={() => act(x, "delete")}>{x.kind === "post" ? "지우기" : "비공개로 내리기"}</button>
              </div>
            </li>
          ))}</ul>}
      </section>
    </Layout>
  );
}
