import { useSyncExternalStore } from "react";
import { createClient } from "@supabase/supabase-js";

export const SB_URL = "https://ltbhffozitpbsxjbnbnd.supabase.co", SB_KEY = "sb_publishable_A-x6BFiK_x60Z_KrZWVMAw_X9XKVjxN";

// 로그인용 클라이언트: 세션을 localStorage에 저장 → 새로고침해도 유지
export const sb = createClient(SB_URL, SB_KEY);

let session; // undefined = 아직 확인 중, null = 비로그인
const subs = new Set();
sb.auth.onAuthStateChange((_e, s) => { session = s; subs.forEach((f) => f()); });
export const useSession = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => session);
