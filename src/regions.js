import { useEffect, useState } from "react";

let cache;
export function useRegions() {
  const [data, setData] = useState(null);
  useEffect(() => { (cache ??= fetch("/regions.json").then((r) => r.json())).then(setData); }, []);
  return data;
}
