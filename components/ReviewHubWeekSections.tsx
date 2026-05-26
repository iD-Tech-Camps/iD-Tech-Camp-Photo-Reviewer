"use client";

import React from "react";
import { partitionReviewHubWeeks } from "@/lib/review-hub-sections";

type ReviewHubWeekSectionsProps<T extends { id: string; startsOn: string; photoCount: number }> = {
  weeks: T[] | null;
  emptyMessage: string;
  activeEmptyMessage?: string;
  upcomingEmptyMessage?: string;
  renderWeek: (week: T, section: "active" | "upcoming") => React.ReactNode;
};

export function ReviewHubWeekSections<T extends { id: string; startsOn: string; photoCount: number }>({
  weeks,
  emptyMessage,
  activeEmptyMessage = "No active weeks with photos to review.",
  upcomingEmptyMessage = "No upcoming weeks scheduled.",
  renderWeek,
}: ReviewHubWeekSectionsProps<T>) {
  const { active, upcoming } = React.useMemo(
    () => partitionReviewHubWeeks(weeks ?? []),
    [weeks],
  );

  if (weeks === null) {
    return null;
  }

  if (weeks.length === 0) {
    return (
      <div className="card" style={{ color: "var(--ink-3)" }}>
        {emptyMessage}
      </div>
    );
  }

  return (
    <>
      <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h2 className="page-eyebrow" style={{ margin: 0 }}>
          Active ({active.length})
        </h2>
        {active.length === 0 ? (
          <div className="card" style={{ color: "var(--ink-3)" }}>{activeEmptyMessage}</div>
        ) : (
          active.map((w) => (
            <React.Fragment key={w.id}>{renderWeek(w, "active")}</React.Fragment>
          ))
        )}
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h2 className="page-eyebrow" style={{ margin: 0 }}>
          Upcoming ({upcoming.length})
        </h2>
        {upcoming.length === 0 ? (
          <div className="card" style={{ color: "var(--ink-3)" }}>{upcomingEmptyMessage}</div>
        ) : (
          upcoming.map((w) => (
            <React.Fragment key={w.id}>{renderWeek(w, "upcoming")}</React.Fragment>
          ))
        )}
      </section>
    </>
  );
}
