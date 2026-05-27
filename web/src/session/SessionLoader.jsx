import React, { useEffect, useState } from "react";
import { getSessionState, ApiError } from "../api.js";
import { useDiscord } from "../discord/DiscordProvider.jsx";
import {
  ExpiredScreen,
  ForbiddenScreen,
  NetworkErrorScreen
} from "../errors/ErrorScreens.jsx";

export function SessionLoader({ children }) {
  const { sessionToken, accessToken, status } = useDiscord();
  const [state, setState] = useState({ phase: "loading", session: null, error: null });
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    if (status !== "ready") return;
    let cancelled = false;
    async function load() {
      try {
        const session = await getSessionState(sessionToken, accessToken);
        if (!cancelled) setState({ phase: "ready", session, error: null });
      } catch (error) {
        if (cancelled) return;
        if (error instanceof ApiError) {
          if (error.status === 410) setState({ phase: "expired", session: null, error });
          else if (error.status === 403) setState({ phase: "forbidden", session: null, error });
          else setState({ phase: "network", session: null, error });
        } else {
          setState({ phase: "network", session: null, error });
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [status, sessionToken, accessToken, retryNonce]);

  if (state.phase === "loading") return <p>Loading calendar…</p>;
  if (state.phase === "expired") return <ExpiredScreen />;
  if (state.phase === "forbidden") return <ForbiddenScreen />;
  if (state.phase === "network") {
    return (
      <NetworkErrorScreen
        onRetry={() => {
          setState({ phase: "loading", session: null, error: null });
          setRetryNonce((n) => n + 1);
        }}
      />
    );
  }
  return children({ session: state.session, setSession: (s) => setState({ phase: "ready", session: s, error: null }) });
}
