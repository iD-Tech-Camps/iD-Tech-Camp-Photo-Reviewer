import "server-only";

// SmugMug API v2 wraps every response in this envelope. smugmugFetch unwraps
// .Response before returning to callers, so consumers see typed payloads
// directly.
export interface SmugMugResponseEnvelope<T> {
  Code: number;
  Message: string;
  Response: T;
}

export interface PageInfo {
  Total: number;
  Start: number;
  Count: number;
  RequestedCount?: number;
  FirstPage?: string;
  NextPage?: string;
  PrevPage?: string;
  LastPage?: string;
}

export type NodeType = "Folder" | "Album" | "Page" | "System" | "Gallery";

export interface SmugMugNode {
  Uri: string;
  WebUri?: string;
  NodeID: string;
  Name: string;
  UrlName?: string;
  Type: NodeType;
  Description?: string;
  Keywords?: string[];
  HasChildren?: boolean;
  IsRoot?: boolean;
  Privacy?: string;
  DateAdded?: string;
  DateModified?: string;
  // When Type === 'Album', the node's Uris.Album points at the album resource.
  Uris?: Record<string, { Uri: string }>;
}

export interface NodeChildrenResponse {
  Uri: string;
  Node: SmugMugNode[];
  Pages?: PageInfo;
}

export interface SmugMugAlbum {
  Uri: string;
  WebUri?: string;
  AlbumKey: string;
  Name: string;
  UrlName?: string;
  ImageCount: number;
  Description?: string;
  Keywords?: string[];
  DateAdded?: string;
  ImagesLastUpdated?: string;
  LastUpdated?: string;
  NodeID?: string;
  Uris?: Record<string, { Uri: string }>;
}

export interface SmugMugImage {
  Uri: string;
  WebUri?: string;
  ImageKey: string;
  FileName?: string;
  Caption?: string;
  Title?: string;
  Keywords?: string[];
  Date?: string;
  DateTimeOriginal?: string;
  DateTimeUploaded?: string;
  Format?: string;
  Width: number;
  Height: number;
  ArchivedUri?: string;
  ArchivedSize?: number;
  ThumbnailUrl?: string;
  IsArchive?: boolean;
  IsVideo?: boolean;
  Uris?: Record<string, { Uri: string }>;
}

export interface AlbumImagesResponse {
  Uri: string;
  AlbumImage: SmugMugImage[];
  Pages?: PageInfo;
}

export interface AuthUserResponse {
  User: {
    Uri: string;
    NickName: string;
    Name: string;
    AccountStatus?: string;
    Domain?: string;
    DomainOnly?: string;
  };
}
