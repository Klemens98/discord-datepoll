import React from "react";
import { DiscordProvider, useDiscord } from "./discord/DiscordProvider.jsx";
import { SessionLoader } from "./session/SessionLoader.jsx";
import { Calendar } from "./calendar/Calendar.jsx";
import { NotInDiscordScreen } from "./errors/ErrorScreens.jsx";

const CLIENT_ID = import.meta.env.VITE_DISCORD_CLIENT_ID;

function Inner() {
  const { status, error } = useDiscord();
  if (status === "loading") return <p>Connecting to Discord…</p>;
  if (status === "no_session_token") return <NotInDiscordScreen />;
  if (status === "auth_failed") return <p>Couldn't authenticate: {String(error?.message ?? error)}</p>;
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
