import "server-only";
import { listNodeChildren } from "../nodes";
import { getUserRootNode } from "../users";
import type { SmugMugNode } from "../types";
import { mapWithConcurrency } from "./concurrency";
import { parseCampWeekName } from "./dates";
import type {
  WalkedDivision,
  WalkedDivisionDeep,
  WalkedLocation,
  WalkedWeek,
  WalkedYear,
} from "./types";

// Bounded fan-out for the tree walk. Locations within a division and
// year folders within a location both walk in parallel, but capped so a
// single sync doesn't fire hundreds of SmugMug requests at once.
const LOCATION_CONCURRENCY = 5;
const YEAR_CONCURRENCY = 5;

/**
 * Top-level walk: returns the SmugMug root node + its immediate children
 * (the candidate divisions). Cheap — one API call for the root, one for
 * its children. Used by the discovery endpoint to render the division
 * picker without paying for a deep walk.
 */
export async function walkDivisions(nickname: string): Promise<{
  rootNodeId: string;
  divisions: WalkedDivision[];
}> {
  const root = await getUserRootNode(nickname);
  const divisions: WalkedDivision[] = [];
  for await (const child of listNodeChildren(root.NodeID)) {
    divisions.push(asWalkedDivision(child));
  }
  return { rootNodeId: root.NodeID, divisions };
}

/**
 * Deep walk for a single division: locations → years → weeks. Used by
 * 8.3b's reconciliation pass and by the discovery endpoint when a
 * specific division is requested for inspection.
 *
 * Year-folder layer is auto-detected: if a location's children are all
 * 4-digit names ("2024", "2025", ...), the location has year folders;
 * otherwise weeks live directly under the location. The reconciliation
 * layer uses this flag to decide where to read date metadata from.
 */
export async function walkDivisionDeep(
  divisionNodeId: string,
  divisionName: string,
  divisionType: string
): Promise<WalkedDivisionDeep> {
  const locationNodes: SmugMugNode[] = [];
  for await (const locationNode of listNodeChildren(divisionNodeId)) {
    // Skip retired-location aggregator folders entirely — see comment on
    // HISTORICAL_LOCATIONS_NAMES. Their child folders aren't actually
    // weeks and aren't current locations, so there's nothing to sync.
    if (isHistoricalLocationsFolder(locationNode.Name)) continue;
    locationNodes.push(locationNode);
  }
  const locations = await mapWithConcurrency(
    locationNodes,
    LOCATION_CONCURRENCY,
    walkLocation
  );
  return {
    smugmugNodeId: divisionNodeId,
    name: divisionName,
    type: divisionType,
    childCount: locations.length,
    locations,
  };
}

const YEAR_PATTERN = /^\d{4}$/;

// Year-level aggregator names — INSIDE a location, these wrap older
// year folders and we want to flatten them into the same year list.
const PAST_SEASONS_NAMES = new Set(["past seasons", "past season", "archive", "archives"]);

// Location-level aggregator names — INSIDE a division, these wrap
// retired location folders. Skipped entirely for V1: we don't sync
// retired-location data, and treating these as locations meant their
// child location-folders surfaced as junk "weeks" with no parseable
// date. If we ever need historical reporting, that's post-V1 work.
const HISTORICAL_LOCATIONS_NAMES = new Set([
  "historical locations",
  "previous locations",
  "past locations",
  "retired locations",
]);

function isYearFolder(name: string): boolean {
  return YEAR_PATTERN.test(name.trim());
}

function isPastSeasonsFolder(name: string): boolean {
  return PAST_SEASONS_NAMES.has(name.trim().toLowerCase());
}

function isHistoricalLocationsFolder(name: string): boolean {
  return HISTORICAL_LOCATIONS_NAMES.has(name.trim().toLowerCase());
}

/**
 * Walks a single location node, classifying its children into:
 *  - **Year folders** (e.g. "2025", "2026") — recursed for weeks.
 *  - **"Past Seasons" aggregator folders** — flattened: each year folder
 *    inside them is treated the same as a direct year folder, so the
 *    walked tree shows old + current seasons in one unified `years` list.
 *  - **Everything else** — surfaced as direct weeks. Some old-school
 *    locations may not use a year layer at all; keeping this branch lets
 *    the walker tolerate that without missing data.
 *
 * `hasYearFolders` is set if we found ANY year folders, regardless of
 * whether other floating children also exist next to them.
 */
async function walkLocation(node: SmugMugNode): Promise<WalkedLocation> {
  const yearNodes: SmugMugNode[] = [];
  const pastSeasonsNodes: SmugMugNode[] = [];
  const directWeekNodes: SmugMugNode[] = [];

  for await (const child of listNodeChildren(node.NodeID)) {
    if (isYearFolder(child.Name)) {
      yearNodes.push(child);
    } else if (isPastSeasonsFolder(child.Name)) {
      pastSeasonsNodes.push(child);
    } else {
      directWeekNodes.push(child);
    }
  }

  // Past Seasons contains year subfolders; flatten them into the same
  // year list so consumers don't have to know the aggregator existed.
  // Anything inside Past Seasons that isn't year-shaped is ignored —
  // it's not in any week-discovery path we care about.
  const pastSeasonsYears: SmugMugNode[] = [];
  for (const psNode of pastSeasonsNodes) {
    for await (const inner of listNodeChildren(psNode.NodeID)) {
      if (isYearFolder(inner.Name)) {
        pastSeasonsYears.push(inner);
      }
    }
  }

  const allYearNodes = [...yearNodes, ...pastSeasonsYears];
  const years = await mapWithConcurrency(allYearNodes, YEAR_CONCURRENCY, walkYear);

  // Sort years descending so newest_first reads naturally.
  years.sort((a, b) => (b.yearNumber ?? 0) - (a.yearNumber ?? 0));

  const weeks: WalkedWeek[] = directWeekNodes.map(asWalkedWeek);

  return {
    smugmugNodeId: node.NodeID,
    name: node.Name,
    type: node.Type,
    hasYearFolders: years.length > 0,
    years,
    weeks,
  };
}

async function walkYear(node: SmugMugNode): Promise<WalkedYear> {
  const yearNumber = Number(node.Name.trim());
  const yearHint = Number.isFinite(yearNumber) ? yearNumber : undefined;
  const weeks: WalkedWeek[] = [];
  for await (const weekNode of listNodeChildren(node.NodeID)) {
    weeks.push(asWalkedWeek(weekNode, yearHint));
  }
  return {
    smugmugNodeId: node.NodeID,
    yearLabel: node.Name,
    yearNumber: yearHint ?? null,
    weekCount: weeks.length,
    weeks,
  };
}

function asWalkedDivision(node: SmugMugNode): WalkedDivision {
  return {
    smugmugNodeId: node.NodeID,
    name: node.Name,
    type: node.Type,
    childCount: typeof node.HasChildren === "boolean" ? null : null,
  };
}

function asWalkedWeek(node: SmugMugNode, yearHint?: number): WalkedWeek {
  return {
    smugmugNodeId: node.NodeID,
    name: node.Name,
    type: node.Type,
    parsed: parseCampWeekName(node.Name, yearHint),
    uri: node.Uri,
  };
}
