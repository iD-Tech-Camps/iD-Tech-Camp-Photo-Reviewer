"use client";

import React from "react";
import { Icon } from "@/components/Icon";
import { usePoints } from "@/lib/points-context";

export function BatchPointsHud({
  variant,
  lastEarned,
}: {
  variant: "sidebar" | "overlay";
  /** Points just earned on the latest submit — drives +N float and pulse. */
  lastEarned: number | null;
}) {
  const { total, loading } = usePoints();
  const [pulse, setPulse] = React.useState(false);
  const [float, setFloat] = React.useState<{ id: number; amount: number } | null>(null);

  React.useEffect(() => {
    if (lastEarned === null || lastEarned <= 0) return;
    setPulse(true);
    const id = Date.now();
    setFloat({ id, amount: lastEarned });
    const t1 = window.setTimeout(() => setPulse(false), 520);
    const t2 = window.setTimeout(() => setFloat(null), 1100);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [lastEarned]);

  const displayTotal = total ?? (loading ? null : 0);

  const isOverlay = variant === "overlay";

  return (
    <div
      className={"batch-points-hud" + (pulse ? " batch-points-hud--pulse" : "")}
      style={
        isOverlay
          ? {
              position: "fixed",
              top: 20,
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 1001,
              pointerEvents: "none",
            }
          : { position: "relative", marginBottom: 16 }
      }
      aria-live="polite"
      aria-atomic="true"
    >
      <div
        className={
          "batch-points-hud-inner" + (isOverlay ? " batch-points-hud-inner--overlay" : "")
        }
      >
        <Icon name="stars" size={isOverlay ? 18 : 14} />
        <div>
          <div className="batch-points-hud-label">Your points</div>
          <div className="batch-points-hud-value">
            {displayTotal === null ? "…" : displayTotal}
          </div>
        </div>
        {float && (
          <span key={float.id} className="batch-points-float">
            +{float.amount}
          </span>
        )}
      </div>
    </div>
  );
}
