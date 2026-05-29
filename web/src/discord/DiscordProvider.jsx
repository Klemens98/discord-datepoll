import React, { createContext, useContext, useEffect, useState } from "react";
import { DiscordSDK } from "@discord/embedded-app-sdk";
import { exchangeAuthCode, resolveCurrentSession } from "../api.js";

const DiscordContext = createContext(null);

export function useDiscord() {
  const ctx = useContext(DiscordContext);
  if (!ctx) throw new Error("useDiscord must be used within DiscordProvider");
  return ctx;
}

function readSessionTokenFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get("datepoll_token") ?? params.get("custom_id");
}

function isDiscordActivityFrame() {
  const params = new URLSearchParams(window.location.search);
  return params.has("frame_id") && params.has("instance_id");
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
    if (!clientId) {
      setState((s) => ({ ...s, status: "config_error" }));
      return;
    }

    if (!isDiscordActivityFrame()) {
      setState((s) => ({ ...s, status: "not_in_discord" }));
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
        await sdk.commands.authenticate({ access_token });

        let sessionToken =
          readSessionTokenFromUrl() ?? sdk.customId ?? null;

        if (!sessionToken) {
          try {
            const current = await resolveCurrentSession(access_token, sdk.channelId);
            sessionToken = current.token;
          } catch {
            sessionToken = null;
          }
        }

        if (cancelled) return;

        if (!sessionToken) {
          setState((s) => ({
            ...s,
            status: "no_session",
            accessToken: access_token,
            sdk
          }));
          return;
        }

        setState((s) => ({
          ...s,
          status: "ready",
          sessionToken,
          accessToken: access_token,
          sdk
        }));
      } catch (error) {
        if (cancelled) return;
        setState((s) => ({ ...s, status: "auth_failed", error }));
      }
    }

    init();
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  return <DiscordContext.Provider value={state}>{children}</DiscordContext.Provider>;
}
