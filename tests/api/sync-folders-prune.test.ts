import { afterAll, beforeAll, expect, it, describe } from "vitest";
import { randomUUID } from "node:crypto";
import { seed, service, teardown, type Fixture } from "../fixtures";
import { reconcileDivisionDeep } from "@/lib/smugmug/sync/reconcile";
import type { WalkedDivisionDeep } from "@/lib/smugmug/sync/types";

// Exercises the orphan-week prune in reconcileDivisionDeep: a camp_weeks row
// whose SmugMug folder no longer appears in the walk is deleted (when it has
// no photos) so it can't keep hijacking the per-location first_week slot.
// Drives reconcile directly — no SmugMug API needed.

let fixture: Fixture;

// The fixture seeds: division (smugmug_folder_id = `${prefix}-div`),
// location (`${prefix}-loc`), and one live week w1 (`${prefix}-w1`) with photos.
let emptyOrphanId: string; // folder gone, no photos → should be pruned
let photoOrphanId: string; // folder gone, has a photo → should be kept
let photoOrphanPhotoId: string;

beforeAll(async () => {
  fixture = await seed({ photos: 1 });

  emptyOrphanId = randomUUID();
  photoOrphanId = randomUUID();
  photoOrphanPhotoId = randomUUID();

  const { error: weeksErr } = await service()
    .from("camp_weeks")
    .insert([
      {
        id: emptyOrphanId,
        location_id: fixture.locationId,
        name: `${fixture.prefix}-orphan-empty`,
        smugmug_folder_id: `${fixture.prefix}-orphan-empty`,
        starts_on: "2026-05-25",
        ends_on: "2026-05-29",
      },
      {
        id: photoOrphanId,
        location_id: fixture.locationId,
        name: `${fixture.prefix}-orphan-photo`,
        smugmug_folder_id: `${fixture.prefix}-orphan-photo`,
        starts_on: "2026-05-26",
        ends_on: "2026-05-30",
      },
    ]);
  if (weeksErr) throw new Error(`seed orphan weeks: ${weeksErr.message}`);

  const { error: photoErr } = await service().from("photos").insert({
    id: photoOrphanPhotoId,
    camp_week_id: photoOrphanId,
    smugmug_image_id: `${fixture.prefix}-orphan-photo-img`,
  });
  if (photoErr) throw new Error(`seed orphan photo: ${photoErr.message}`);
});

afterAll(async () => {
  // Pruned-empty orphan is already gone; clean the kept photo-orphan + its photo.
  await service().from("photos").delete().eq("id", photoOrphanPhotoId);
  await service().from("camp_weeks").delete().eq("id", photoOrphanId);
  await service().from("camp_weeks").delete().eq("id", emptyOrphanId);
  await teardown(fixture);
});

function walkedWithOnlyLiveWeek(): WalkedDivisionDeep {
  // Walk reports the division + location with ONLY the live week w1 present —
  // the two orphan folders are absent (deleted on SmugMug).
  return {
    smugmugNodeId: `${fixture.prefix}-div`,
    name: `${fixture.prefix}-div`,
    type: "Folder",
    childCount: 1,
    locations: [
      {
        smugmugNodeId: `${fixture.prefix}-loc`,
        name: `${fixture.prefix}-loc`,
        type: "Folder",
        hasYearFolders: false,
        years: [],
        weeks: [
          {
            smugmugNodeId: `${fixture.prefix}-w1`,
            name: `${fixture.prefix}-week1`,
            type: "Album",
            parsed: { startDate: "2026-06-01", endDate: "2026-06-05", year: 2026 },
            uri: `/api/v2/node/${fixture.prefix}-w1`,
          },
        ],
      },
    ],
  };
}

describe("reconcileDivisionDeep orphan-week prune", () => {
  it("deletes a folderless zero-photo week and keeps one that still has photos", async () => {
    const result = await reconcileDivisionDeep(service(), walkedWithOnlyLiveWeek());

    // The empty orphan was pruned and reported.
    expect(result.weeks.prunedOrphans.map((o) => o.smugmugNodeId)).toContain(
      `${fixture.prefix}-orphan-empty`,
    );
    const empty = await service()
      .from("camp_weeks")
      .select("id")
      .eq("id", emptyOrphanId)
      .maybeSingle();
    expect(empty.data).toBeNull();

    // The photo-bearing orphan was kept (FK RESTRICT / preserve reviewed work)
    // and surfaced for an admin to investigate.
    expect(result.weeks.orphansKeptWithPhotos.map((o) => o.smugmugNodeId)).toContain(
      `${fixture.prefix}-orphan-photo`,
    );
    const kept = await service()
      .from("camp_weeks")
      .select("id")
      .eq("id", photoOrphanId)
      .maybeSingle();
    expect(kept.data?.id).toBe(photoOrphanId);

    // The live week is untouched.
    const live = await service()
      .from("camp_weeks")
      .select("id")
      .eq("smugmug_folder_id", `${fixture.prefix}-w1`)
      .maybeSingle();
    expect(live.data?.id).toBe(fixture.campWeekId);
  });
});
