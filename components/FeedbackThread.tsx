"use client";

import type { FeedbackEvent } from "@/lib/location-approval";

// A single feedback note, rendered as a quoted thread entry. Shared by the
// Lead-review location screen and the camp-week dashboard so notes look the
// same wherever the thread appears.
export function FeedbackRow({ event }: { event: FeedbackEvent }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        paddingLeft: 10,
        borderLeft: "2px solid var(--rule)",
      }}
    >
      <div style={{ fontSize: 12, color: "var(--ink-3)", display: "flex", gap: 8, flexWrap: "wrap" }}>
        <span>{event.authorName ?? "—"}</span>
        <span>·</span>
        <span>{new Date(event.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
      </div>
      <div style={{ fontSize: 14, whiteSpace: "pre-wrap" }}>{event.body}</div>
    </div>
  );
}
