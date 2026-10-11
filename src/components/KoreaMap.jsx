// regions.json 지도. pathsRef로 지역 path DOM을 넘겨준다 (룰렛 깜빡임·다트 판정용)
export default function KoreaMap({ data, height, picked, svgRef, pathsRef, children }) {
  const inset = data?.inset;
  return (
    <svg id="map" ref={svgRef} viewBox={`0 0 400 ${height ?? data?.h ?? 672}`}>
      <g id="regions">
        {data?.regions.map((r, i) => (
          <path key={r.id} d={r.d} className={picked === r ? "picked" : undefined} ref={pathsRef && ((el) => { pathsRef.current[i] = el; })} />
        ))}
      </g>
      {inset && <>
        <rect id="inset" fill="none" strokeDasharray="3 3" x={inset.x} y={inset.y} width={inset.w} height={inset.h} />
        <g id="dokdo">
          <circle cx={inset.dokdo[0]} cy={inset.dokdo[1]} r="2" />
          <text x={inset.dokdo[0]} y={inset.dokdo[1] + 12} fontSize="8" textAnchor="middle">독도</text>
        </g>
      </>}
      {picked && <g id="labels"><text className="label" x={picked.cx} y={picked.cy - 8}>{picked.name}</text></g>}
      {children}
    </svg>
  );
}
