import { useEffect, useReducer, useRef } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { sb, useSession } from "../supabase.js";
import Layout from "../components/Layout.jsx";
import KoreaMap from "../components/KoreaMap.jsx";
import Record from "../components/Record.jsx";
import ShareSheet from "../components/Share.jsx";
import PublicTrip, { mapLink, MapPin } from "../components/PublicTrip.jsx";
import { useRegions } from "../regions.js";

// ── 저장·같이 고치기: 로그인한 사용자의 trip (Supabase) ──
// DB 규칙(RLS): trip 멤버만 읽고 쓴다. 친구는 초대 링크(/invite/토큰)로 멤버가 된다 → supabase/schema.sql, Invite.jsx
// 변경이 생기면 broadcast로 "바뀜"만 알리고, 받은 쪽이 다시 불러온다.
// ponytail: 입력칸에 커서가 있는 동안엔 남의 변경을 미뤘다가 포커스가 빠지면 반영. 글자 단위 동시 편집이 필요해지면 CRDT로.
const byTime = (a, b) => (a.time || "99").localeCompare(b.time || "99");
const hex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");
const uuid = () => hex(16).replace(/(.{8})(.{4})(.{4})(.{4})/, "$1-$2-$3-$4-");

// 캘린더 파일(.ics): 가는 날부터 n일차 = +n일. 시간 있는 항목은 다음 항목까지(없으면 1시간), 시간 없는 항목은 그날 종일
// 시간대 없이(floating) 적어서 폰 시간대 그대로 들어간다 (국내 여행이라 충분)
function ics(plan) {
  const esc = (t) => String(t).replace(/[\\;,]/g, (c) => "\\" + c).replace(/\n/g, "\\n");
  const day = (d) => { const t = new Date(plan.start_on + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10).replaceAll("-", ""); };
  const hm = (x) => /^\d{1,2}:\d{2}$/.test(x) ? x.padStart(5, "0").replace(":", "") + "00" : null;
  const ev = plan.days.flatMap((d, di) => d.items.filter((it) => it.what).map((it, k, all) => {
    const st = hm(it.time), next = all.slice(k + 1).map((x) => hm(x.time)).find(Boolean);
    const end = st && (next && next > st ? next : String(Math.min(23, +st.slice(0, 2) + 1)).padStart(2, "0") + st.slice(2));
    return ["BEGIN:VEVENT", `UID:${it.id}@eodigaji`, `DTSTAMP:${new Date().toISOString().replace(/[-:]|\.\d+/g, "")}`,
      st ? `DTSTART:${day(di)}T${st}` : `DTSTART;VALUE=DATE:${day(di)}`, st ? `DTEND:${day(di)}T${end}` : `DTEND;VALUE=DATE:${day(di + 1)}`,
      `SUMMARY:${esc(it.what)}`, `LOCATION:${esc(plan.prov + " " + plan.place)}`, "END:VEVENT"];
  }));
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//eodigaji//KO", `X-WR-CALNAME:${esc(plan.title)}`, ...ev, "END:VCALENDAR"].join("\r\n");
}
const dday = (d) => { const n = Math.round((new Date(d + "T00:00:00") - new Date(new Date().toDateString())) / 864e5); return n > 0 ? `D-${n}` : n === 0 ? "D-day" : null; };
export { dday };

function samplePlan(place) {
  return {
    title: `${place} 1박 2일`,
    days: [
      { day: "1일차", items: [
        { time: "10:00", what: `${place} 도착, 시내 산책` },
        { time: "12:30", what: "현지 맛집에서 점심" },
        { time: "15:00", what: "대표 명소 구경" },
        { time: "18:30", what: "저녁 먹고 숙소 체크인" },
      ] },
      { day: "2일차", items: [
        { time: "09:00", what: "숙소 근처 카페에서 아침" },
        { time: "11:00", what: "근교 자연 명소" },
        { time: "13:00", what: "점심 후 기념품 쇼핑" },
        { time: "16:00", what: "귀가" },
      ] },
    ],
    tip: "AI 연결 전이라 샘플 일정이에요. 자유롭게 고쳐 쓰세요.",
    sample: true,
  };
}

// /plan?r=지역번호 → 이 브라우저에 저장된 일정 (없으면 AI, 안 되면 샘플)
// /plan/:id → 저장된 일정 (Supabase, 로그인 필요)
export default function Plan() {
  const { id } = useParams();
  const r = useSearchParams()[0].get("r");
  const nav = useNavigate();
  const session = useSession(), uid = session?.user.id;
  const data = useRegions();
  const sectionRef = useRef(), bodyRef = useRef();
  const [, render] = useReducer((n) => n + 1, 0);
  // 일정은 고칠 때마다 직접 바꾸고 render()로 다시 그린다 (예전 vanilla 구조 그대로)
  const s = useRef({ plan: null, dirty: new Set(), titleDirty: false, stale: false, note: null, missing: null }).current;
  const rerender = () => { s.note = null; render(); }; // 구조가 바뀌면 안내 문구도 기본으로

  const savePlan = () => { try { localStorage.setItem(s.planKey, JSON.stringify(s.plan)); } catch {} };

  function connect(planId) {
    disconnect();
    s.chan = sb.channel("trip-" + planId).on("broadcast", { event: "changed" }, () => { s.stale = true; refresh(); })
      .subscribe((st) => { if (st === "SUBSCRIBED" && history.state?.usr?.joined) s.chan.send({ type: "broadcast", event: "changed", payload: {} }); }); // 막 들어온 멤버 → 다른 사람 아바타 갱신
  }
  function disconnect() { clearTimeout(s.flushTimer); s.chan && sb.removeChannel(s.chan); s.chan = null; s.dirty.clear(); s.titleDirty = s.stale = false; }

  async function loadShared(planId, join) {
    const get = () => Promise.all([sb.from("trips").select().eq("id", planId).maybeSingle(), sb.from("items").select().eq("trip_id", planId), sb.rpc("trip_people", { tid: planId })]);
    let [p, it, people] = await get();
    if (join && !p.error && !p.data && (await sb.rpc("join_trip", { tid: planId })).data) [p, it, people] = await get(); // A3 이전 옛 링크(주인 없는 trip)
    if (p.error || it.error || !p.data) throw p.error || it.error || new Error("없는 일정");
    const n = Math.max(2, ...it.data.map((i) => i.day + 1));
    s.people = people.data ?? [];
    s.plan = { id: planId, shared: p.data.shared, prov: p.data.prov, place: p.data.place, title: p.data.title, tip: p.data.tip, status: p.data.status, done_on: p.data.done_on, is_public: p.data.is_public, hidden: p.data.hidden, start_on: p.data.start_on,
      days: Array.from({ length: n }, (_, d) => ({ day: `${d + 1}일차`,
        items: it.data.filter((i) => i.day === d).map(({ id, time, what }) => ({ id, time, what })).sort(byTime) })) };
    s.stale = false;
  }

  async function refresh() {
    const el = document.activeElement;
    if (!s.plan?.id || s.dirty.size || s.titleDirty || (el?.tagName === "INPUT" && sectionRef.current?.contains(el))) return;
    try { await loadShared(s.plan.id); savePlan(); rerender(); } catch {}
  }

  const itemRow = (it) => ({ id: it.id, trip_id: s.plan.id, day: s.plan.days.findIndex((d) => d.items.includes(it)), time: it.time, what: it.what });
  function synced({ error }) {
    if (error) { s.note = "저장 실패: " + error.message; return render(); }
    s.chan?.send({ type: "broadcast", event: "changed", payload: {} });
  }
  function queueFlush() { if (s.plan.id) { clearTimeout(s.flushTimer); s.flushTimer = setTimeout(flush, 400); } }
  async function flush() {
    const rows = [...s.dirty].map(itemRow).filter((row) => row.day >= 0);
    s.dirty.clear();
    if (s.titleDirty) { s.titleDirty = false; synced(await sb.from("trips").update({ title: s.plan.title }).eq("id", s.plan.id)); }
    if (rows.length) synced(await sb.from("items").upsert(rows));
    if (s.stale) refresh();
  }

  useEffect(() => {
    if (!data || session === undefined) return;
    let dead = false;
    s.plan = null; s.missing = null; s.pub = null; rerender();
    (async () => {
      if (id) {
        if (!uid) { s.missing = "login"; return render(); }
        connect(id);
        try { await loadShared(id, true); } catch {
          disconnect();
          const { data: pub } = await sb.rpc("public_trips", { p_prov: "", p_place: "", p_id: id }); // 멤버가 아니면: 공개 일정이면 읽기 전용으로
          if (dead) return;
          if (pub?.[0]) { const { data: rep } = await sb.from("reports").select("trip_id").eq("trip_id", id); s.pub = { ...pub[0], reported: !!rep?.length }; } else s.missing = "gone";
          return render();
        }
      } else {
        const region = data.regions[r];
        if (!region) return nav("/", { replace: true });
        s.planKey = "eodigaji:plan:" + region.prov + region.name;
        let plan;
        try { plan = JSON.parse(localStorage.getItem(s.planKey)); } catch {}
        if (!plan) {
          try {
            const res = await fetch("/api/plan?place=" + encodeURIComponent(`${region.prov} ${region.name}`));
            if (!res.ok) throw res;
            plan = await res.json();
          } catch { plan = samplePlan(region.name); }
        }
        if (dead) return;
        s.plan = Object.assign(plan, { prov: region.prov, place: region.name });
        if (plan.id) {           // 저장한 일정이면 최신본으로. 못 불러오면(로그아웃·다른 계정) 저장 안 한 일정으로 취급
          if (uid) connect(plan.id);
          try { if (!uid) throw 0; await loadShared(plan.id); } catch { disconnect(); delete plan.id; delete plan.shared; }
        }
      }
      if (dead) return;
      s.plan.days.forEach((d) => d.items.forEach((it) => (it.id ??= uuid()))); // React key
      s.planKey = "eodigaji:plan:" + s.plan.prov + s.plan.place;
      savePlan(); rerender();
    })();
    return () => { dead = true; disconnect(); };
  }, [data, id, r, uid]);

  useEffect(() => { // + 일정 추가 직후 그 칸에 커서
    if (s.focusId) { bodyRef.current?.querySelector(`[data-id="${s.focusId}"]`)?.focus(); s.focusId = null; }
  });

  function edit(it, k, v) {
    it[k] = v;
    s.dirty.add(it);
    if (k === "time") s.timeEdited = true;
    savePlan(); queueFlush(); render();
  }
  function sortDay(d) { // 시간 고친 칸에서 나가면 그 날 다시 정렬
    if (!s.timeEdited) return;
    s.timeEdited = false;
    s.plan.days[d].items.sort(byTime);
    savePlan(); rerender();
  }
  function del(d, i) {
    const [it] = s.plan.days[d].items.splice(i, 1);
    s.dirty.delete(it);
    if (s.plan.id) sb.from("items").delete().eq("id", it.id).then(synced);
    savePlan(); rerender();
  }
  function add(d) {
    const it = { id: uuid(), time: "", what: "" };
    s.plan.days[d].items.push(it);
    s.dirty.add(it); queueFlush();
    s.focusId = it.id;
    savePlan(); rerender();
  }

  // 저장 = 내 trip 만들기 (멤버는 나 혼자). 비로그인이면 로그인 갔다가 이 화면으로 돌아온다 (고친 일정은 localStorage에 그대로)
  async function save() {
    const plan = s.plan;
    if (plan.id) return true;
    if (!uid) { nav("/login?next=" + encodeURIComponent(location.pathname + location.search)); return false; }
    const planId = hex(16);
    connect(planId);
    const res = await sb.from("trips").insert({ id: planId, owner_id: uid, prov: plan.prov, place: plan.place, title: plan.title, tip: plan.tip });
    plan.id = planId;
    const res2 = res.error ? res : await sb.from("items").insert(plan.days.flatMap((d) => d.items.map(itemRow)));
    if (res2.error) { // 반쯤 만들어진 trip은 지운다
      if (!res.error) await sb.from("trips").delete().eq("id", planId);
      plan.id = undefined; disconnect(); s.note = "저장 실패: " + res2.error.message; render(); return false;
    }
    history.replaceState(history.state, "", "/plan/" + planId); // 라우터를 거치지 않고 주소만 바꿈 → 일정을 다시 불러오지 않음
    savePlan(); s.note = "저장됨 · 내 지도에서 볼 수 있어요"; render();
    return true;
  }

  async function invite() {
    const plan = s.plan;
    if (!(await save())) return;
    const token = hex(16); // 누를 때마다 새 링크 (7일 뒤 만료)
    const { error } = await sb.from("invites").insert({ token, trip_id: plan.id });
    const res = error ? { error } : plan.shared ? {} : await sb.from("trips").update({ shared: true }).eq("id", plan.id);
    if (res.error) { s.note = "초대 실패: " + res.error.message; return render(); }
    plan.shared = true; savePlan();
    s.inviteUrl = location.origin + "/invite/" + token; render(); // 공유 시트 (카카오톡·링크 복사·다른 앱)
  }
  async function setStart(v) {
    s.plan.start_on = v || null; savePlan(); render();
    const { error } = await sb.from("trips").update({ start_on: v || null }).eq("id", s.plan.id);
    if (error) { s.note = "날짜 저장 실패: " + error.message; render(); } else synced({});
  }
  function saveIcs() {
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([ics(s.plan)], { type: "text/calendar" })), download: (s.plan.title || s.plan.place) + ".ics" });
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  const plan = s.plan, at = plan ?? s.pub;
  const region = data && (at ? data.regions.find((x) => x.prov === at.prov && x.name === at.place) : data.regions[r]);

  if (s.pub) return ( // 남의 공개 일정: 읽기 전용
    <Layout view="plan" map={<KoreaMap data={data} picked={region} />} status={region && [region.name, `${region.prov} · 다른 사람 일정`]}>
      <section id="plan" className="screen plan-ro">
        <button className="back" onClick={() => nav(region ? "/region/" + region.id : "/")}>← {region ? region.name + " 둘러보기" : "처음으로"}</button>
        <h2 className="title" id="planTitle">{s.pub.title || s.pub.place}</h2>
        <p className="note" id="planNote">다른 사람이 공개한 일정 · 읽기 전용이에요. 고치려면 [이 일정으로 짜기]</p>
        <PublicTrip t={s.pub} uid={uid} reload={async () => {
          const [{ data: pub }, { data: rep }] = await Promise.all([sb.rpc("public_trips", { p_prov: "", p_place: "", p_id: s.pub.id }), sb.from("reports").select("trip_id").eq("trip_id", s.pub.id)]);
          if (pub?.[0]) { s.pub = { ...pub[0], reported: !!rep?.length }; render(); }
        }} />
      </section>
    </Layout>
  );
  const note = s.note ?? (plan ? (plan.shared ? "같이 고치는 중 · " : plan.id ? "저장됨 · " : plan.sample ? "샘플 일정 · " : "") + "눌러서 바로 고칠 수 있어요" : "");

  return (
    <Layout view="plan" map={<KoreaMap data={data} picked={region} />} status={region && [region.name, `${region.prov} · 여기로 결정!`]}>
      <section id="plan" className="screen" ref={sectionRef} onBlur={() => setTimeout(() => s.stale && refresh())}>
        <button id="back" className="back" onClick={() => nav("/")}>← 다시 뽑기</button>
        <input id="planTitle" className="title" aria-label="여행 제목" value={plan?.title ?? region?.name ?? ""}
          onChange={(e) => { if (!plan) return; plan.title = e.target.value; s.titleDirty = true; savePlan(); queueFlush(); render(); }} />
        <p className="note" id="planNote">{note}</p>
        {plan?.hidden && <p className="note" role="alert">신고가 쌓여 이 일정이 공개 목록에서 숨겨졌어요. 운영자가 확인한 뒤 다시 보이거나 비공개로 바뀌어요.</p>}
        {plan?.id && <div className="when">
          <label>가는 날<input type="date" name="start" value={plan.start_on ?? ""} onChange={(e) => setStart(e.target.value)} /></label>
          {plan.start_on && dday(plan.start_on) && <b>{dday(plan.start_on)}</b>}
          {plan.start_on && <button type="button" className="add" id="ics" onClick={saveIcs}>캘린더에 넣기 (.ics)</button>}
        </div>}
        {plan?.id && s.people?.length > 1 && (
          <ul className="people" aria-label="같이 고치는 사람">
            {s.people.map((m) => (
              <li key={m.user_id} title={m.nickname + (m.role === "owner" ? " (만든 사람)" : "")}>
                {m.avatar_url ? <img src={m.avatar_url} alt={m.nickname} referrerPolicy="no-referrer" /> : <span aria-label={m.nickname}>{[...(m.nickname || "?")][0]}</span>}
              </li>
            ))}
          </ul>
        )}
        {!plan ? (
          <div id="planBody" className={s.missing ? "" : "loading"}>
            {s.missing === "login" ? <>로그인하면 이 일정을 볼 수 있어요. <a href={"/login?next=" + encodeURIComponent(location.pathname)}>로그인</a></>
              : s.missing ? "일정을 찾을 수 없어요. 링크를 다시 확인해 주세요." : id ? "일정 불러오는 중…" : "일정 짜는 중…"}
          </div>
        ) : (
          <div id="planBody" ref={bodyRef}>
            {plan.days.map((d, di) => (
              <section className="day" key={di}>
                <h3>{d.day}</h3>
                {d.items.map((it, i) => (
                  <div className="row" key={it.id}>
                    <input className="time" inputMode="numeric" maxLength={5} placeholder="00:00" aria-label="시간" value={it.time ?? ""}
                      onChange={(e) => edit(it, "time", e.target.value)} onBlur={() => sortDay(di)} />
                    <input className="what" placeholder="할 일" aria-label="할 일" data-id={it.id} value={it.what ?? ""}
                      onChange={(e) => edit(it, "what", e.target.value)} />
                    {it.what && <a className="maplink" href={mapLink(`${plan.place} ${it.what}`)} target="_blank" rel="noopener" aria-label={`${it.what} 지도에서 찾기`}><MapPin /></a>}
                    <button data-del={`${di},${i}`} aria-label="삭제" onClick={() => del(di, i)}>✕</button>
                  </div>
                ))}
                <button className="add" data-add={di} onClick={() => add(di)}>+ 일정 추가</button>
              </section>
            ))}
            {plan.tip && <p className="tip">{plan.tip}</p>}
          </div>
        )}
        <button id="save" className="btn" hidden={!plan || !!plan.id} onClick={save}>이 일정 저장</button>
        <button id="invite" className={plan?.id ? "btn" : "btn sub"} hidden={!plan} onClick={invite}>{plan?.shared ? "초대 링크 다시 보내기" : "친구 초대"}</button>
        <ShareSheet open={!!s.inviteUrl} onClose={() => { s.inviteUrl = null; render(); }} title="같이 여행 일정 고치자!" text={`${plan?.title ?? ""} · 이 링크로 들어오면 같이 고칠 수 있어요 (7일)`} url={s.inviteUrl} />
        {plan?.id && uid && <Record plan={plan} uid={uid} onChange={(v) => { Object.assign(plan, v); savePlan(); render(); }} />}
      </section>
    </Layout>
  );
}
