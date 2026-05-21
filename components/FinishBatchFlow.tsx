"use client";

import React from "react";
import type { ToastApi } from "@/components/Shell";

type FinishUi = null | "confirm" | "success";

export type FinishBatchFlowOptions = {
  releaseUrl: string;
  reviewedCount: number;
  total: number;
  weekLabel: string;
  onBackToHub: () => void;
  onStartAnotherBatch: () => Promise<void>;
  toast: ToastApi;
};

export function useFinishBatchFlow({
  releaseUrl,
  reviewedCount,
  total,
  weekLabel,
  onBackToHub,
  onStartAnotherBatch,
  toast,
}: FinishBatchFlowOptions) {
  const [ui, setUi] = React.useState<FinishUi>(null);
  const [busy, setBusy] = React.useState(false);

  const unreviewed = Math.max(0, total - reviewedCount);
  const allDone = total === 0 || (total > 0 && reviewedCount === total);

  const release = React.useCallback(async () => {
    const res = await fetch(releaseUrl, { method: "POST" });
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new Error(json.error ?? "Could not finish batch");
  }, [releaseUrl]);

  const clickFinish = React.useCallback(() => {
    if (total === 0) {
      void (async () => {
        setBusy(true);
        try {
          await release();
          onBackToHub();
        } catch (err: unknown) {
          toast.show(err instanceof Error ? err.message : "Could not finish batch", "x");
        } finally {
          setBusy(false);
        }
      })();
      return;
    }
    if (allDone) {
      void (async () => {
        setBusy(true);
        try {
          await release();
          setUi("success");
        } catch (err: unknown) {
          toast.show(err instanceof Error ? err.message : "Could not finish batch", "x");
        } finally {
          setBusy(false);
        }
      })();
      return;
    }
    setUi("confirm");
  }, [allDone, total, release, toast, onBackToHub]);

  const confirmPartial = React.useCallback(() => {
    void (async () => {
      setBusy(true);
      try {
        await release();
        setUi(null);
        toast.show(
          unreviewed === 1
            ? "1 unreviewed photo returned to the queue"
            : `${unreviewed} unreviewed photos returned to the queue`,
          "check",
        );
        onBackToHub();
      } catch (err: unknown) {
        toast.show(err instanceof Error ? err.message : "Could not finish batch", "x");
      } finally {
        setBusy(false);
      }
    })();
  }, [release, unreviewed, toast, onBackToHub]);

  const cancel = React.useCallback(() => setUi(null), []);

  const backFromSuccess = React.useCallback(() => {
    setUi(null);
    onBackToHub();
  }, [onBackToHub]);

  const startAnother = React.useCallback(() => {
    void (async () => {
      setBusy(true);
      try {
        setUi(null);
        await onStartAnotherBatch();
      } catch (err: unknown) {
        toast.show(err instanceof Error ? err.message : "Could not start batch", "x");
        onBackToHub();
      } finally {
        setBusy(false);
      }
    })();
  }, [onStartAnotherBatch, toast, onBackToHub]);

  const dialog =
    ui === "confirm" ? (
      <FinishBatchDialog
        eyebrow="Finish batch"
        title="Release unreviewed photos?"
        tone="sun"
        onClose={busy ? undefined : cancel}
      >
        <p style={{ color: "var(--ink-2)", lineHeight: 1.55, margin: "0 0 20px" }}>
          You reviewed {reviewedCount} of {total} in this batch for{" "}
          <strong>{weekLabel}</strong>. The remaining {unreviewed} will go back to the
          queue for other reviewers.
        </p>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <button type="button" className="btn btn-ghost" onClick={cancel} disabled={busy}>
            Keep reviewing
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void confirmPartial()} disabled={busy}>
            {busy ? "Finishing…" : "Finish batch"}
          </button>
        </div>
      </FinishBatchDialog>
    ) : ui === "success" ? (
      <FinishBatchDialog
        eyebrow="Batch complete"
        title="Nice work!"
        tone="moss"
        onClose={busy ? undefined : backFromSuccess}
      >
        <p style={{ color: "var(--ink-2)", lineHeight: 1.55, margin: "0 0 20px" }}>
          You reviewed all {total} photo{total === 1 ? "" : "s"} in this batch for{" "}
          <strong>{weekLabel}</strong>.
        </p>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <button type="button" className="btn btn-ghost" onClick={backFromSuccess} disabled={busy}>
            Back to hub
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void startAnother()} disabled={busy}>
            {busy ? "Starting…" : "Start another batch"}
          </button>
        </div>
      </FinishBatchDialog>
    ) : null;

  return { clickFinish, dialog, busy, allDone };
}

function FinishBatchDialog({
  eyebrow,
  title,
  tone,
  onClose,
  children,
}: {
  eyebrow: string;
  title: string;
  tone: "moss" | "sun";
  onClose?: () => void;
  children: React.ReactNode;
}) {
  const toneVar = tone === "moss" ? "var(--moss)" : "var(--sun)";
  React.useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="finish-batch-title"
      onClick={onClose ? onClose : undefined}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1100,
        background: "rgba(20, 25, 30, 0.55)",
        backdropFilter: "blur(4px)",
        display: "grid",
        placeItems: "center",
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="card"
        style={{
          width: "100%",
          maxWidth: 480,
          padding: 24,
          boxShadow: "var(--shadow-lg)",
        }}
      >
        <div style={{ marginBottom: 16 }}>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: toneVar,
              marginBottom: 4,
            }}
          >
            {eyebrow}
          </div>
          <h2
            id="finish-batch-title"
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 22,
              fontWeight: 500,
              letterSpacing: "-0.02em",
              margin: 0,
            }}
          >
            {title}
          </h2>
        </div>
        {children}
      </div>
    </div>
  );
}
