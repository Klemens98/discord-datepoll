import React, { useState } from "react";
import { DayPicker } from "react-day-picker";
import "react-day-picker/style.css";
import { Summary } from "./Summary.jsx";
import { toggleDate } from "../api.js";
import { useDiscord } from "../discord/DiscordProvider.jsx";
import { PublishButton } from "../publish/PublishButton.jsx";

function toDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function fromDateKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function Calendar({ session, setSession }) {
  const { sessionToken, accessToken } = useDiscord();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function onDayClick(date) {
    const key = toDateKey(date);
    const wasSelected = session.selectedDates.includes(key);
    const optimistic = wasSelected
      ? session.selectedDates.filter((k) => k !== key)
      : [...session.selectedDates, key];
    setSession({ ...session, selectedDates: optimistic });
    setSaving(true);
    setError(null);
    try {
      const { selectedDates } = await toggleDate(sessionToken, key, accessToken);
      setSession({ ...session, selectedDates });
    } catch (err) {
      setSession({ ...session, selectedDates: session.selectedDates });
      setError("Couldn't save. Try again.");
    } finally {
      setSaving(false);
    }
  }

  const selectedDates = session.selectedDates.map(fromDateKey);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return (
    <div className="calendar">
      <h2>{session.title}</h2>
      <Summary selectedDates={session.selectedDates} />
      <DayPicker
        mode="multiple"
        selected={selectedDates}
        onDayClick={onDayClick}
        disabled={{ before: today }}
      />
      {saving && <p className="muted">Saving…</p>}
      {error && <p className="error-inline">{error}</p>}
      <PublishButton session={session} />
    </div>
  );
}
