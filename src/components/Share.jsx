import { useEffect, useRef, useState } from "react";

// 공유 시트: 아래에서 올라오는 모달 → [카카오톡] [링크 복사] [이미지 저장] [다른 앱]
// url = 보낼 링크(초대 등, 없으면 사이트 주소), file = 보낼 이미지(정복 지도 카드) → 있으면 [이미지 저장]
// 카카오톡은 VITE_KAKAO_JS_KEY(카카오 디벨로퍼스 JavaScript 키 · 사이트 도메인 등록 필요)가 있을 때만. SDK는 시트를 열 때 미리 받는다 (Safari는 누른 순간 바로 열어야 해서)
const KAKAO = import.meta.env.VITE_KAKAO_JS_KEY;
let kakao;
const loadKakao = () => (kakao ??= new Promise((ok, no) => {
  const s = Object.assign(document.createElement("script"), { src: "https://t1.kakaocdn.net/kakao_js_sdk/2.7.2/kakao.min.js", crossOrigin: "anonymous" });
  s.onload = () => { if (!window.Kakao.isInitialized()) window.Kakao.init(KAKAO); ok(window.Kakao); };
  s.onerror = () => { kakao = null; no(new Error("카카오 SDK를 못 불러왔어요")); };
  document.head.append(s);
}));

const I = { // 24px 선 아이콘
  kakao: <path d="M12 4C7 4 3 7.1 3 11c0 2.5 1.7 4.7 4.2 5.9L6.5 20l3.6-2.3c.6.1 1.2.1 1.9.1 5 0 9-3.1 9-7s-4-6.8-9-6.8Z" fill="currentColor" stroke="none" />,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>,
  save: <><path d="M12 4v11m0 0-4-4m4 4 4-4" /><path d="M5 19h14" /></>,
  more: <><circle cx="6" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="18" cy="12" r="1.5" /></>,
};
const Icon = ({ k }) => <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{I[k]}</svg>;

export default function ShareSheet({ open, onClose, title, text, url, file, fileName }) {
  const ref = useRef(), [note, setNote] = useState(""), [href, setHref] = useState("");
  useEffect(() => {
    const d = ref.current;
    if (open && !d.open) { setNote(""); d.showModal(); if (KAKAO) loadKakao().catch(() => {}); }
    if (!open && d.open) d.close();
  }, [open]);
  useEffect(() => { if (!file) return; const u = URL.createObjectURL(file); setHref(u); return () => URL.revokeObjectURL(u); }, [file]);
  const link = url ?? location.origin;
  const more = navigator.share && (!file || navigator.canShare?.({ files: [file] }));

  async function toKakao() {
    try {
      const K = await loadKakao(), to = { mobileWebUrl: link, webUrl: link };
      if (file) {
        const { infos } = await K.Share.uploadImage({ file: [file] });
        K.Share.sendDefault({ objectType: "feed", content: { title, description: text, imageUrl: infos.original.url, link: to }, buttons: [{ title: "나도 뽑아보기", link: to }] });
      } else K.Share.sendDefault({ objectType: "text", text: `${title}\n${text}`, link: to, buttonTitle: "열기" });
    } catch (e) { setNote("카카오톡 공유 실패: " + (e.message || e)); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(link); setNote("링크를 복사했어요"); }
    catch { setNote("복사가 막혔어요. 이 링크를 길게 눌러 복사하세요: " + link); }
  }
  const system = () => navigator.share(file ? { files: [file], title } : { title, text, url: link }).then(onClose, () => {});

  return (
    <dialog ref={ref} className="sheet" aria-label="공유하기" onClose={onClose} onClick={(e) => e.target === ref.current && onClose()}>
      <div>
        <h2>{title}</h2>
        <div className="share-btns">
          {KAKAO && <button type="button" data-share="kakao" onClick={toKakao}><span className="kakao"><Icon k="kakao" /></span>카카오톡</button>}
          <button type="button" data-share="copy" onClick={copy}><span><Icon k="copy" /></span>링크 복사</button>
          {file && <a data-share="save" href={href} download={fileName}><span><Icon k="save" /></span>이미지 저장</a>}
          {more && <button type="button" data-share="more" onClick={system}><span><Icon k="more" /></span>다른 앱</button>}
        </div>
        <p className="note" aria-live="polite">{note}</p>
        <button type="button" className="btn sub" onClick={onClose}>닫기</button>
      </div>
    </dialog>
  );
}
