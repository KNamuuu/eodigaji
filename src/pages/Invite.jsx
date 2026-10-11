import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import Layout from "../components/Layout.jsx";
import KoreaMap from "../components/KoreaMap.jsx";
import { useRegions } from "../regions.js";
import { sb, useSession } from "../supabase.js";

// 초대 링크 /invite/:token → 로그인 → 멤버 등록(accept_invite) → 그 일정으로
export default function Invite() {
  const { token } = useParams(), data = useRegions(), session = useSession(), nav = useNavigate();
  const [bad, setBad] = useState(false);
  useEffect(() => {
    if (session === null) nav("/login?next=" + encodeURIComponent("/invite/" + token), { replace: true });
    if (!session) return;
    sb.rpc("accept_invite", { tok: token }).then(({ data: tid }) => tid ? nav("/plan/" + tid, { replace: true, state: { joined: true } }) : setBad(true));
  }, [session?.user.id, token]);

  return (
    <Layout view="invite" map={<KoreaMap data={data} />} status={["초대", "같이 여행 일정 고치기"]}>
      <section id="invite-page" className="screen">
        <p className="help">{bad ? <>초대 링크가 만료됐거나 잘못됐어요. 친구에게 새 링크를 받아 주세요. <Link to="/">뽑으러 가기</Link></> : "초대받은 일정 여는 중…"}</p>
      </section>
    </Layout>
  );
}
