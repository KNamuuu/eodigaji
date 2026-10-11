import Layout from "../components/Layout.jsx";
import KoreaMap from "../components/KoreaMap.jsx";
import { useRegions } from "../regions.js";

// 내 지도: 빈 껍데기 (A3·C2에서 채움)
export default function Me() {
  const data = useRegions();
  return (
    <Layout view="me" status={["내 지도", "다녀온 곳이 여기 칠해질 거예요"]} map={<KoreaMap data={data} />}>
      <section className="screen"><p className="help">다녀온 지역과 내 여행 목록이 여기 생겨요.</p></section>
    </Layout>
  );
}
