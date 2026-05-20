import { fireConfetti } from "@/components/Shell";

export type ReviewBumpResult = {
  earned: number;
  newTotal: number;
  newEventCount: number;
};

/** Lifetime totals — sparse confetti for big round numbers. */
const LIFETIME_CONFETTI = [100, 250, 500, 1000];

/** Lifetime totals — quick pulse only, no confetti. */
const LIFETIME_PULSE = [25, 50, 75, 150, 200];

/** Photos completed in the current batch — toast only. */
const BATCH_TOAST = [10, 25, 50, 100];

function crossedThreshold(prev: number, next: number, threshold: number): boolean {
  return prev < threshold && next >= threshold;
}

export function celebrateReviewBump(
  prevLifetimeCount: number,
  bump: ReviewBumpResult,
  batchCountAfter: number,
  toast: (msg: string, icon?: string) => void,
): void {
  const { earned, newEventCount } = bump;
  if (earned <= 0 && batchCountAfter === 1) {
    toast("First one down — keep going!", "check");
    return;
  }

  for (const t of LIFETIME_CONFETTI) {
    if (crossedThreshold(prevLifetimeCount, newEventCount, t)) {
      fireConfetti(window.innerWidth / 2, window.innerHeight * 0.28, t >= 500 ? 70 : 45);
      toast(`${t} photos reviewed — nice work!`, "stars");
      return;
    }
  }

  for (const t of LIFETIME_PULSE) {
    if (crossedThreshold(prevLifetimeCount, newEventCount, t)) {
      toast(`${t} reviews logged`, "check");
      return;
    }
  }

  for (const t of BATCH_TOAST) {
    if (batchCountAfter === t) {
      toast(`${t} in this batch`, "check");
      return;
    }
  }
}
