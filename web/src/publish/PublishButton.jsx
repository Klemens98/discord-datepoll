import React, { useState } from "react";
import { publishPoll, ApiError } from "../api.js";
import { useDiscord } from "../discord/DiscordProvider.jsx";

export function PublishButton({ session }) {
  const { sessionToken, accessToken, sdk } = useDiscord();
  const [state, setState] = useState({ phase: "idle", error: null });

  async function onPublish() {
    setState({ phase: "publishing", error: null });
    try {
      await publishPoll(sessionToken, accessToken);
      setState({ phase: "published", error: null });
      setTimeout(() => {
        if (sdk && sdk.commands && typeof sdk.commands.close === "function") {
          sdk.commands.close();
        }
      }, 2000);
    } catch (err) {
      let message = "Couldn't publish.";
      if (err instanceof ApiError && err.body?.error === "missing_permissions") {
        message = "Bot lacks View Channel or Send Messages in this channel.";
      }
      setState({ phase: "idle", error: message });
    }
  }

  if (state.phase === "published") {
    return (
      <div className="success">
        <h2>Poll published</h2>
        <p>You can close this panel.</p>
      </div>
    );
  }

  return (
    <div className="publish-row">
      <button
        className="primary"
        onClick={onPublish}
        disabled={state.phase === "publishing" || session.selectedDates.length === 0}
      >
        {state.phase === "publishing" ? "Publishing…" : `Publish (${session.selectedDates.length})`}
      </button>
      {state.error && <p className="error-inline">{state.error}</p>}
    </div>
  );
}
