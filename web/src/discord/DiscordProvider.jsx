import React, { createContext, useContext, useEffect, useState } from "react";
import { DiscordSDK } from "@discord/embedded-app-sdk";
import { exchangeAuthCode } from "../api.js";

const DiscordContext = createContext(null);

export function useDiscord() {
  const ctx = useContext(DiscordContext);
  if (!ctx) throw new Error("useDiscord must be used within DiscordProvider");
  return ctx;
}

function readSessionTokenFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get("datepoll_token");
}

export function DiscordProvider({ children, clientId }) {
  const [state, setState] = useState({
    status: "loading",
    sessionToken: readSessionTokenFromUrl(),
    accessToken: null,
    sdk: null,
    error: null
  });

  useEffect(() => {
    if (!state.sessionToken) {
      setState((s) => ({ ...s, status: "no_session_token" }));
      return;
    }

    let cancelled = false;
    async function init() {
      try {
        const sdk = new DiscordSDK(clientId);
        await sdk.ready();
        const { code } = await sdk.commands.authorize({
          client_id: clientId,
          response_type: "code",
          state: "",
          prompt: "none",
          scope: ["identify"]
        });
        const { access_token } = await exchangeAuthCode(code);
        if (cancelled) return;
        setState((s) => ({ ...s, status: "ready", accessToken: access_token, sdk }));
      } catch (error) {
        if (cancelled) return;
        setState((s) => ({ ...s, status: "auth_failed", error }));
      }
    }
    init();
    return () => {
      cancelled = true;
    };
  }, [clientId, state.sessionToken]);

  return <DiscordContext.Provider value={state}>{children}</DiscordContext.Provider>;
}
