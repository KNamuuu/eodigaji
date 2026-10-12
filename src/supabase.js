import { useEffect, useState, useSyncExternalStore } from "react";
import { createClient } from "@supabase/supabase-js";

export const SB_URL = "https://ltbhffozitpbsxjbnbnd.supabase.co", SB_KEY = "sb_publishable_A-x6BFiK_x60Z_KrZWVMAw_X9XKVjxN";

// 로그인용 클라이언트: 세션을 localStorage에 저장 → 새로고침해도 유지
export const sb = createClient(SB_URL, SB_KEY);

let session; // undefined = 아직 확인 중, null = 비로그인
const subs = new Set();
sb.auth.onAuthStateChange((_e, s) => { session = s; subs.forEach((f) => f()); });
export const useSession = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => session);

// 사진 서명 URL은 1시간짜리. 50분이 지나면(다른 탭 갔다 돌아올 때 포함) 숫자가 바뀐다 → 사진 받는 effect의 deps에 넣어 새 URL을 받게
// 만료 시간은 1시간 그대로 둔다 (URL이 새도 1시간 뒤엔 못 엶)
export function useResign() {
  const [n, setN] = useState(0);
  useEffect(() => {
    let at = Date.now();
    const check = () => { if (document.visibilityState === "visible" && Date.now() - at > 50 * 60e3) { at = Date.now(); setN((x) => x + 1); } };
    const t = setInterval(check, 60e3);
    document.addEventListener("visibilitychange", check);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", check); };
  }, []);
  return n;
}
