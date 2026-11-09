export type { Product, ProductRef, ProductVariant } from "@sceneflow/schema";

export interface User {
  id: string;
  email: string;
  name: string;
}

export interface Workspace {
  id: string;
  name: string;
  type: "personal" | "team";
  planId: string;
  role: "viewer" | "editor" | "admin" | "owner";
}

export interface Project {
  id: string;
  workspaceId: string;
  siteId: string | null;
  name: string;
  status: "draft" | "published" | "archived";
  currentDraftVersion: number;
  publishedVersion: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface MediaRendition {
  src: string;
  width: number;
  height: number;
  kind: "progressive" | "scrub";
  sizeBytes: number;
}

export interface MediaMetadata {
  duration?: number;
  width?: number;
  height?: number;
  hasAudio?: boolean;
  proxyUrl?: string;
  posterUrl?: string;
  editorUrl?: string;
  audioUrl?: string;
  waveformUrl?: string;
  thumbnails?: string[];
  progress?: { stage: string; percent: number };
  renditions?: { status: "pending" | "ready" | "failed" | "skipped"; items: MediaRendition[]; error?: string };
}

/** One line of the "Something not working?" panel. */
export interface Diagnostic {
  id: string;
  status: "ok" | "info" | "warn" | "fail";
  title: string;
  detail?: string;
  fix?: { label: string; href: string };
}

export interface MediaAsset {
  id: string;
  workspaceId: string;
  type: "video" | "image" | "audio";
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  status: "pending" | "uploaded" | "processing" | "ready" | "failed";
  metadataJson: MediaMetadata;
  error: string | null;
  createdAt: string;
}

export interface VersionSummary {
  version: number;
  state: "draft" | "published";
  checksum: string;
  createdAt: string;
}

export interface Site {
  id: string;
  workspaceId: string;
  url: string;
  name: string | null;
  platform: "wordpress" | "html" | "react";
  connectionStatus: "pending" | "connected" | "error";
  connectorVersion: string | null;
  platformVersion: string | null;
  capabilitiesJson: string[];
  lastSeenAt: string | null;
  lastError: string | null;
  createdAt: string;
}

export interface SitePublishResult {
  siteId: string;
  siteName: string | null;
  ok: boolean;
  error?: string;
  shortcode?: string;
}

export interface RemotePage {
  id: number;
  title: string;
  url: string;
  type: string;
  path: string;
}

export type PlacementMode = "replace" | "before" | "after" | "append" | "prepend";

export interface Placement {
  id: string;
  projectId: string;
  siteId: string;
  postId: number | null;
  path: string | null;
  pageUrl: string | null;
  pageTitle: string | null;
  selector: string;
  mode: PlacementMode;
  createdAt: string;
}

/** A product source the editor can pick from (WooCommerce of the connected site, hand-entered products...). */
export interface CatalogProviderInfo {
  id: string;
  label: string;
  editable: boolean;
}
