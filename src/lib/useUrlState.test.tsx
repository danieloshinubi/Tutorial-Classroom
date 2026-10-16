import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";
import { useUrlState } from "./useUrlState";

const TABS = ["stream", "materials", "exams"] as const;

const Probe = () => {
  const [tab, setTab] = useUrlState("tab", "stream", TABS);
  const { search } = useLocation();
  return (
    <div>
      <p>{`tab:${tab}`}</p>
      <p>{`search:${search}`}</p>
      <button onClick={() => setTab("exams")}>{"exams"}</button>
      <button onClick={() => setTab("stream")}>{"stream"}</button>
    </div>
  );
};

const at = (url: string) => {
  window.history.replaceState(null, "", url);
  return render(
    <BrowserRouter>
      <Routes>
        <Route path="/c" element={<Probe />} />
      </Routes>
    </BrowserRouter>,
  );
};

test("opens on the tab named in the address, as after a reload", () => {
  at("/c?tab=materials&session=2");
  expect(screen.getByText("tab:materials")).toBeInTheDocument();
});

test("an unknown tab in the address falls back to the first", () => {
  at("/c?tab=nonsense");
  expect(screen.getByText("tab:stream")).toBeInTheDocument();
});

test("changing tab writes it to the address and keeps other params", () => {
  at("/c?session=2");
  fireEvent.click(screen.getByText("exams"));
  expect(screen.getByText("tab:exams")).toBeInTheDocument();
  expect(screen.getByText(/search:/).textContent).toContain("tab=exams");
  expect(screen.getByText(/search:/).textContent).toContain("session=2");
  fireEvent.click(screen.getByText("stream"));
  expect(screen.getByText(/search:/).textContent).not.toContain("tab=");
});
