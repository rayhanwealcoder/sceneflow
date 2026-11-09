import type { BrandKit, Preset } from "@sceneflow/schema";

export type { BrandKit, Preset, PresetConfig, PresetInput, PresetScope, PresetType, Product, ProductRef, ProductVariant } from "@sceneflow/schema";

/** A preset stored in the cloud library (personal or workspace scope). */
export interface LibraryPreset extends Preset {
  workspaceId: string;
  mine: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BrandKitRow {
  id: string;
  workspaceId: string;
  name: string;
  config: BrandKit;
  version: number;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

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

/** `GET /projects/:id/analytics` (doc §24). */
export interface AnalyticsSummary {
  range: { days: number; from: string; to: string };
  totals: {
    loads: number;
    sessions: number;
    plays: number;
    playRate: number | null;
    quartiles: { q25: number; q50: number; q75: number; complete: number };
    completes: number;
    completionRate: number | null;
    avgWatchSeconds: number;
    clicks: number;
    productViews: number;
    addToCarts: number;
    checkouts: number;
    coupons: number;
    errors: number;
  };
  daily: Array<{ day: string; loads: number; plays: number; completes: number; clicks: number }>;
  timeline: { buckets: number; duration: number; values: number[] };
  scenes: Array<{ sceneId: string; name: string; start: number; end: number; enters: number; sessions: number }>;
  elements: Array<{ layerId: string; name: string; type: string; impressions: number; clicks: number; ctr: number | null }>;
  products: Array<{ productId: string; title: string; views: number; addToCarts: number; checkouts: number }>;
  devices: { desktop: number; tablet: number; mobile: number };
  pages: Array<{ host: string; path: string; loads: number }>;
}

/** A product source the editor can pick from (WooCommerce of the connected site, hand-entered products...). */
export interface CatalogProviderInfo {
  id: string;
  label: string;
  editable: boolean;
}
