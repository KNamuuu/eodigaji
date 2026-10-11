// regions.json 지도. pathsRef로 지역 path DOM을 넘겨준다 (룰렛 깜빡임·다트 판정용). out = 흐리게 할 지역 index Set
// visited = 칠할 지역 index Set, regionProps(r, i) = 지역 path에 붙일 이벤트 등 (내 지도)
export default function KoreaMap({ data, height, picked, out, visited, regionProps, svgRef, pathsRef, children }) {
  return (
    <svg id="map" ref={svgRef} viewBox={`0 0 400 ${height ?? data?.h ?? 672}`}>
      <g id="regions">
        {data?.regions.map((r, i) => (
          <path key={r.id} d={r.d} className={picked === r ? "picked" : out?.has(i) ? "out" : visited?.has(i) ? "visited" : undefined} {...regionProps?.(r, i)} ref={pathsRef && ((el) => { pathsRef.current[i] = el; })} />
        ))}
      </g>
      {data && <g id="dokdo">
        <circle cx={data.dokdo[0]} cy={data.dokdo[1]} r="1.5" />
        <text x={data.dokdo[0]} y={data.dokdo[1] + 10} fontSize="7" textAnchor="middle">독도</text>
      </g>}
      {picked && <g id="labels"><text className="label" x={picked.cx} y={picked.cy - 8}>{picked.name}</text></g>}
      {children}
    </svg>
  );
}
