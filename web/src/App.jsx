import React from "react";
import { DiscordProvider, useDiscord } from "./discord/DiscordProvider.jsx";
import { SessionLoader } from "./session/SessionLoader.jsx";
import { Calendar } from "./calendar/Calendar.jsx";
import {
  ConfigErrorScreen,
  NoSessionScreen,
  NotInDiscordScreen
} from "./errors/ErrorScreens.jsx";

const CLIENT_ID = import.meta.env.VITE_DISCORD_CLIENT_ID;

function Inner() {
  const { status, error } = useDiscord();
  if (status === "loading") return <p className="muted">Connecting to Discord…</p>;
  if (status === "config_error") return <ConfigErrorScreen />;
  if (status === "not_in_discord") return <NotInDiscordScreen />;
  if (status === "no_session") return <NoSessionScreen />;
  if (status === "auth_failed") {
    return (
      <div className="error">
        <h2>Authentication failed</h2>
        <p>{String(error?.message ?? error)}</p>
      </div>
    );
  }
  return (
    <SessionLoader>
      {({ session, setSession }) => <Calendar session={session} setSession={setSession} />}
    </SessionLoader>
  );
}

export default function App() {
  return (
    <div className="app">
      <DiscordProvider clientId={CLIENT_ID}>
        <Inner />
      </DiscordProvider>
    </div>
  );
}
