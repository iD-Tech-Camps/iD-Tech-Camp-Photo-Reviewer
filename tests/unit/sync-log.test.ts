import { describe, expect, it } from "vitest";
import {
  formatSyncCompleteToast,
  formatSyncLogCounts,
  formatSyncLogSummary,
  formatSyncPhotoChanges,
} from "@/lib/sync-log";

describe("sync log formatting", () => {
  const row = {
    kind: "manual" as const,
    weeksInScope: 8,
    imagesSeen: 377,
    photosAdded: 21,
    photosUpdated: 0,
    photosRemoved: 0,
  };

  it("formats scope and photo changes in plain language", () => {
    expect(formatSyncLogCounts(row)).toBe(
      "Checked 8 camp weeks; 377 images; 21 added",
    );
  });

  it("says no photo changes when deltas are zero", () => {
    expect(formatSyncPhotoChanges({ photosAdded: 0, photosUpdated: 0, photosRemoved: 0 })).toBe(
      "no photo changes",
    );
    expect(formatSyncLogCounts({ ...row, photosAdded: 0 })).toBe(
      "Checked 8 camp weeks; 377 images; no photo changes",
    );
  });

  it("prefixes status for summary and toast", () => {
    expect(formatSyncLogSummary({ ...row, status: "success" })).toBe(
      "Success: Checked 8 camp weeks; 377 images; 21 added",
    );
    expect(formatSyncCompleteToast(row)).toBe(
      "Sync complete. Checked 8 camp weeks; 377 images; 21 added",
    );
  });
});
