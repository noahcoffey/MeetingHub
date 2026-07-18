"use client";

import { useEffect, useState } from "react";

// Switches the 7-day trend overlay on/off (data-trend on <html>), persisted in
// localStorage and applied flash-free by the init script in the root layout.
export function TrendToggle() {
  const [on, setOn] = useState(false);

  useEffect(() => {
    setOn(document.documentElement.dataset.trend === "on");
  }, []);

  function toggle() {
    setOn((v) => {
      const next = !v;
      document.documentElement.dataset.trend = next ? "on" : "off";
      try {
        localStorage.setItem("mh:trend", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className={`trend-toggle ${on ? "is-on" : ""}`}
      onClick={toggle}
    >
      <span className="trend-switch" aria-hidden>
        <span className="trend-knob" />
      </span>
      Trend line
    </button>
  );
}
