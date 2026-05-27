import React from "react";
import { DiscordProvider, useDiscord } from "./discord/DiscordProvider.jsx";

const CLIENT_ID = import.meta.env.VITE_DISCORD_CLIENT_ID;

function Inner() {
  const { status, error } = useDiscord();
  if (status === "loading") return <p>Connecting to Discord…</p>;
  if (status === "no_session_token") return <p>Open this page from the Discord activity launcher.</p>;
  if (status === "auth_failed") return <p>Couldn't authenticate: {String(error?.message ?? error)}</p>;
  return <p>Authenticated. Calendar coming next.</p>;
}

export default function App() {
  return (
    <div className="app">
      <h1>DatePoll</h1>
      <DiscordProvider clientId={CLIENT_ID}>
        <Inner />
      </DiscordProvider>
    </div>
  );
}
