import React from "react";

function formatLabel(key) {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric"
  }).format(date);
}

export function Summary({ selectedDates }) {
  if (selectedDates.length === 0) {
    return <p className="muted">No dates selected yet — tap a day to add it.</p>;
  }
  const sorted = [...selectedDates].sort();
  const labels = sorted.map(formatLabel);
  if (sorted.length <= 6) {
    return <p><strong>{sorted.length}</strong> date{sorted.length === 1 ? "" : "s"} selected — {labels.join(", ")}</p>;
  }
  return <p><strong>{sorted.length}</strong> dates selected — {labels.slice(0, 5).join(", ")}, +{sorted.length - 5} more</p>;
}
