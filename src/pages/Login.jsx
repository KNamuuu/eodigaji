import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import Layout from "../components/Layout.jsx";
import KoreaMap from "../components/KoreaMap.jsx";
import { useRegions } from "../regions.js";
import { sb, useSession } from "../supabase.js";

// 로그인: 카카오 · 구글 · 이메일 링크. 끝나면 ?next= 로 돌아간다
export default function Login() {
  const data = useRegions(), session = useSession(), nav = useNavigate();
  const n = useSearchParams()[0].get("next"), next = /^\/(?![/\\])/.test(n) ? n : "/"; // 내 사이트 주소만 (//evil.com 막기)
  const [email, setEmail] = useState(""), [note, setNote] = useState(""), [busy, setBusy] = useState(false);
  // 지난 로그인 실패가 남긴 ?error=…를 돌아올 주소에서 뺀다. 남아 있으면 supabase-js가 돌아온 토큰을 오류로 보고 버린다
  const back = new URL(next, location.origin);
  for (const k of ["error", "error_code", "error_description"]) back.searchParams.delete(k);
  const redirectTo = back.href;

  useEffect(() => { if (session) nav(next, { replace: true }); }, [session]);

  async function oauth(provider) {
    setBusy(true);
    const { error } = await sb.auth.signInWithOAuth({ provider, options: { redirectTo } });
    if (error) { setNote("로그인 실패: " + error.message); setBusy(false); }
  }
  async function magic(e) {
    e.preventDefault();
    setBusy(true); setNote("");
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } });
    setBusy(false);
    setNote(error ? "보내기 실패: " + error.message : `${email} 로 로그인 링크를 보냈어요. 메일함을 확인하세요.`);
  }

  return (
    <Layout view="login" map={<KoreaMap data={data} />} status={["로그인", "뽑기는 로그인 없이도 돼요"]}>
      <section id="login" className="screen">
        <p className="help">저장·초대·사진 올리기에 로그인이 필요해요.</p>
        <button className="btn kakao" disabled={busy} onClick={() => oauth("kakao")}>카카오로 계속하기</button>
        <button className="btn sub" disabled={busy} onClick={() => oauth("google")}>구글로 계속하기</button>
        <form className="magic" onSubmit={magic}>
          <label htmlFor="email">또는 이메일로 로그인 링크 받기</label>
          <input id="email" type="email" required autoComplete="email" placeholder="me@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button className="btn sub" disabled={busy}>로그인 링크 보내기</button>
        </form>
        <p className="note" aria-live="polite">{note}</p>
        <p className="note">계속하면 <Link to="/terms">이용약관</Link>과 <Link to="/privacy">개인정보 처리방침</Link>에 동의하는 것으로 봐요.</p>
      </section>
    </Layout>
  );
}
