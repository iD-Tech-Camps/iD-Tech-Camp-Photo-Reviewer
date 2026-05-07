import "server-only";
import type { ParsedWeekRange } from "./dates";

/**
 * Shapes returned by the iD Tech tree walker. These describe SmugMug's
 * view of the world — they aren't DB rows. The reconciliation layer
 * (8.3b) translates these into divisions / locations / camp_weeks rows.
 */

export interface WalkedDivision {
  smugmugNodeId: string;
  name: string;
  type: string;
  childCount: number | null;
}

export interface WalkedYear {
  smugmugNodeId: string;
  yearLabel: string;
  yearNumber: number | null;
  weekCount: number;
  weeks: WalkedWeek[];
}

export interface WalkedWeek {
  smugmugNodeId: string;
  name: string;
  type: string;
  parsed: ParsedWeekRange | null;
  /** SmugMug node URI for the album (when type === 'Album'); used by 8.4 to enumerate images. */
  uri: string;
}

export interface WalkedLocation {
  smugmugNodeId: string;
  name: string;
  type: string;
  /** When true, locations have a Year-folder layer; when false, weeks live directly under the location. */
  hasYearFolders: boolean;
  years: WalkedYear[];
  /** Populated when hasYearFolders is false; otherwise empty. */
  weeks: WalkedWeek[];
}

export interface WalkedDivisionDeep extends WalkedDivision {
  locations: WalkedLocation[];
}
