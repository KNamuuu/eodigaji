import { Link, useLocation } from "react-router-dom";
import Layout from "../components/Layout.jsx";
import KoreaMap from "../components/KoreaMap.jsx";
import { useRegions } from "../regions.js";

// /terms 이용약관 · /privacy 개인정보 처리방침 (구글 앱 게시 브랜딩에 이 주소를 넣는다)
const CONTACT = "iptime1199@gmail.com", SINCE = "2026년 10월 12일";

const terms = <>
  <h3>1. 서비스</h3>
  <p>어디가지(이하 "서비스")는 전국 167개 시·군·구 중 한 곳을 뽑아 여행 일정을 짜고, 다녀온 기록과 사진을 남기는 서비스입니다. 뽑기는 로그인 없이 쓸 수 있고, 저장·초대·기록에는 카카오·구글·이메일 로그인이 필요합니다.</p>
  <h3>2. 내가 올린 것</h3>
  <p>일정·기록·사진의 권리는 올린 사람에게 있습니다. 서비스는 그것을 보여주고 저장하는 데 필요한 만큼만 씁니다. "공개"로 둔 기록은 로그인한 다른 사용자가 지역 피드에서 볼 수 있고(작성자 이름은 안 보임), 초대한 친구는 그 여행의 일정과 기록을 봅니다.</p>
  <h3>3. 하면 안 되는 것</h3>
  <p>남의 얼굴·연락처 등 개인정보가 드러나는 사진, 광고·도배, 욕설, 불법 촬영물이나 남의 저작물을 올리면 안 됩니다. 신고가 3건 쌓인 기록은 자동으로 숨겨지고, 운영자가 지울 수 있습니다.</p>
  <h3>4. 탈퇴</h3>
  <p>내 여행 화면 맨 아래 [계정 삭제]로 언제든 탈퇴할 수 있습니다. 내 기록과 사진은 바로 지워집니다. 친구와 같이 쓰던 여행은 남은 친구에게 넘어갑니다.</p>
  <h3>5. 책임</h3>
  <p>서비스는 무료로, 있는 그대로 제공됩니다. 추천된 지역·일정의 영업시간·교통 등은 직접 확인하세요. 서비스는 예고 후 바뀌거나 끝날 수 있고, 끝나기 전에 알립니다.</p>
  <h3>6. 문의</h3>
  <p>{CONTACT}</p>
</>;

const privacy = <>
  <h3>1. 모으는 정보</h3>
  <ul>
    <li>로그인: 이메일, 이름(닉네임), 프로필 사진 주소 — 카카오·구글이 넘겨주는 것만</li>
    <li>내가 만든 것: 여행 일정, 다녀온 날짜, 기록(한 줄·장소 이름·공개 여부), 사진, 신고 내역</li>
    <li>사진은 브라우저에서 긴 변 1600px로 줄이며 다시 저장해 촬영 위치(GPS) 등 EXIF 정보를 지운 뒤 올립니다</li>
  </ul>
  <p>광고·분석용 추적 도구는 쓰지 않습니다. 로그인 상태 유지를 위해 브라우저 저장소(localStorage)만 씁니다.</p>
  <h3>2. 쓰는 곳</h3>
  <p>로그인, 일정 저장·친구와 같이 고치기, 기록·사진 보여주기, 신고 처리. 다른 목적으로 쓰거나 팔지 않습니다.</p>
  <h3>3. 보관 기간</h3>
  <p>계정을 삭제할 때까지. 계정을 삭제하면 프로필·기록·사진·신고 내역을 바로 지웁니다. 친구와 같이 쓰던 여행 일정은 남은 친구에게 넘어갑니다. 기록 하나를 지우면 그 사진도 같이 지워집니다.</p>
  <h3>4. 맡기는 곳 (국외 이전 포함)</h3>
  <ul>
    <li>Supabase Inc. — 데이터베이스·사진 저장·로그인 (서버: 일본 도쿄, 서비스 이용 중 인터넷으로 전송)</li>
    <li>Vercel Inc. — 웹사이트 호스팅 (미국)</li>
    <li>카카오, Google — 로그인 (사용자가 고른 경우만)</li>
  </ul>
  <h3>5. 내 권리</h3>
  <p>내 정보는 내 여행·기록 화면에서 보고 고치고 지울 수 있고, [계정 삭제]로 전부 지울 수 있습니다. 그 밖의 요청은 아래로 메일 주세요.</p>
  <h3>6. 개인정보 보호책임자</h3>
  <p>{CONTACT}</p>
  <p className="note">시행일: {SINCE}</p>
</>;

export default function Legal() {
  const data = useRegions(), isTerms = useLocation().pathname === "/terms";
  const title = isTerms ? "이용약관" : "개인정보 처리방침";
  return (
    <Layout view="legal" map={<KoreaMap data={data} />} status={[title, "시행일 " + SINCE]}>
      <section id="legal" className="screen">
        <h2 className="title">{title}</h2>
        {isTerms ? terms : privacy}
        <p className="help"><Link to={isTerms ? "/privacy" : "/terms"}>{isTerms ? "개인정보 처리방침" : "이용약관"}</Link> · <Link to="/">처음으로</Link></p>
      </section>
    </Layout>
  );
}
