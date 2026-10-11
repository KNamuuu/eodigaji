import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import Home from "./pages/Home.jsx";
import Plan from "./pages/Plan.jsx";
import Me from "./pages/Me.jsx";
import "./index.css";

// 옛 초대 링크 /?plan=id → /plan/id
const old = new URLSearchParams(location.search).get("plan");
if (old) history.replaceState(null, "", "/plan/" + encodeURIComponent(old));

createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/plan" element={<Plan />} />{/* 공유 전 일정: /plan?r=지역번호 */}
      <Route path="/plan/:id" element={<Plan />} />
      <Route path="/me" element={<Me />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  </BrowserRouter>,
);
