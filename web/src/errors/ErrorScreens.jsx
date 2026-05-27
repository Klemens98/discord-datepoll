import React from "react";

export function NotInDiscordScreen() {
  return (
    <div className="error">
      <h2>Open this from Discord</h2>
      <p>This page is only meaningful inside Discord's Activity panel. Run <code>/datepoll</code> in a channel and click <strong>Open Calendar →</strong>.</p>
    </div>
  );
}

export function ExpiredScreen() {
  return (
    <div className="error">
      <h2>Session expired</h2>
      <p>This date-poll session has timed out. Close this panel and run <code>/datepoll</code> again.</p>
    </div>
  );
}

export function ForbiddenScreen() {
  return (
    <div className="error">
      <h2>Not your calendar</h2>
      <p>Only the person who ran <code>/datepoll</code> can use this calendar.</p>
    </div>
  );
}

export function NetworkErrorScreen({ onRetry }) {
  return (
    <div className="error">
      <h2>Network problem</h2>
      <p>Couldn't reach DatePoll's server.</p>
      <button className="primary" onClick={onRetry}>Try again</button>
    </div>
  );
}
