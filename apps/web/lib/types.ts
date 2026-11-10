import type { BrandKit, Preset } from "@sceneflow/schema";

export type { AiScript, AiScriptScene, AiCopyKind, AiTone, BrandKit, CaptionCue, Captions, Preset, PresetConfig, PresetInput, PresetScope, PresetType, Product, ProductRef, ProductVariant } from "@sceneflow/schema";

/** `GET /api/v1/ai/status`: which AI helpers this server can offer. */
export interface AiVoice {
  id: string;
  name: string;
  language?: string;
  gender?: string;
}
export interface AiStatus {
  text: { provider: string; label: string; real: boolean };
  speech: { provider: string; label: string; voices: AiVoice[] } | null;
  transcription: { provider: string; label: string } | null;
  hints: string[];
}

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

export type WorkspaceRole = Workspace["role"];

/** Doc §23: Draft → Internal Review → Client Review → Approved (→ Published is `Project.status`). */
export type ReviewStatus = "none" | "internal" | "client" | "changes" | "approved";

export interface Project {
  id: string;
  workspaceId: string;
  siteId: string | null;
  clientId: string | null;
  name: string;
  status: "draft" | "published" | "archived";
  currentDraftVersion: number;
  publishedVersion: number | null;
  approvalRequired: boolean;
  reviewStatus: ReviewStatus;
  reviewVersion: number | null;
  reviewUpdatedAt: string | null;
  approvedVersion: number | null;
  approvedChecksum: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  reviewTokenExpiresAt: string | null;
  hasReviewLink: boolean;
  createdAt: string;
  updatedAt: string;
}

/** `GET /api/v1/projects/:id` */
export interface ProjectDetail {
  project: Project;
  role: WorkspaceRole;
  client: { id: string; name: string; brandKitId: string | null } | null;
  draft: { version: number; state: "draft" | "published"; checksum: string; config: unknown } | null;
}

export interface Client {
  id: string;
  workspaceId: string;
  name: string;
  contactName: string | null;
  contactEmail: string | null;
  notes: string | null;
  brandKitId: string | null;
  projectCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceMember {
  userId: string;
  name: string;
  email: string;
  role: WorkspaceRole;
  joinedAt: string;
}

export interface WorkspaceDetail {
  workspace: { id: string; name: string; type: "personal" | "team"; planId: string; ownerId: string };
  role: WorkspaceRole;
  members: WorkspaceMember[];
}

export interface Invite {
  id: string;
  role: WorkspaceRole;
  email: string | null;
  expiresAt: string;
  createdAt: string;
}

/** A review comment, anchored to time / scene / element / a point on the stage (all optional). */
export interface Comment {
  id: string;
  projectId: string;
  parentId: string | null;
  authorId: string | null;
  authorName: string;
  source: "team" | "client";
  body: string;
  t: number | null;
  sceneId: string | null;
  layerId: string | null;
  x: number | null;
  y: number | null;
  mentionsJson: string[];
  resolvedAt: string | null;
  resolvedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export type CommentAnchor = { t?: number | null; sceneId?: string | null; layerId?: string | null; x?: number | null; y?: number | null };

export type ActivityType = "review_requested" | "client_review_requested" | "approved" | "changes_requested" | "review_reset" | "published" | "comment" | "client_comment" | "exported";

/* ---------- MP4 export ---------- */

export type ExportStatus = "queued" | "rendering" | "ready" | "failed";
export type ExportQuality = "1080p" | "720p";
export type ExportDevice = "desktop" | "tablet" | "mobile";

export interface ExportOptions {
  quality: ExportQuality;
  width: number;
  height: number;
  fps: number;
  device: ExportDevice;
}

/** `GET /api/v1/projects/:id/exports` — one rendered (or rendering) MP4. */
export interface VideoExport {
  id: string;
  workspaceId: string;
  projectId: string;
  requestedBy: string | null;
  requestedByName: string;
  source: "draft" | "published";
  version: number;
  checksum: string;
  options: ExportOptions;
  status: ExportStatus;
  progress: { stage: string; percent: number } | null;
  fileName: string | null;
  /** Authenticated download (attachment) once `status` is ready. */
  fileUrl: string | null;
  sizeBytes: number | null;
  durationSec: number | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExportRequest {
  source: "draft" | "published";
  quality: ExportQuality;
  fps: 24 | 25 | 30 | 60;
  device: "auto" | ExportDevice;
}

export interface Activity {
  id: string;
  projectId: string;
  projectName: string;
  type: ActivityType;
  actorName: string;
  detail: string | null;
  createdAt: string;
}

export interface DashboardAlert {
  kind: "site_error" | "waiting_client" | "approved_unpublished" | "changes_requested" | "player_errors" | "stale_draft";
  severity: "warn" | "fail" | "info";
  projectId?: string;
  title: string;
  detail?: string;
  href: string;
}

export interface DashboardProject extends Project {
  clientName: string | null;
  site: { id: string; name: string | null; url: string; connectionStatus: "pending" | "connected" | "error"; lastError: string | null } | null;
  draftNewer: boolean;
  openComments: number;
  totalComments: number;
  stats7d: { loads: number; plays: number; clicks: number; addToCarts: number; errors: number };
}

/** `GET /api/v1/workspaces/:id/dashboard` */
export interface Dashboard {
  clients: Array<{ id: string; name: string; projectCount: number }>;
  projects: DashboardProject[];
  alerts: DashboardAlert[];
  mentions: Array<{ id: string; projectId: string; projectName: string; authorName: string; body: string; createdAt: string; t: number | null; sceneId: string | null }>;
  activity: Activity[];
  totals: { projects: number; published: number; inReview: number; openComments: number; loads7d: number; plays7d: number; clicks7d: number };
}

/** `GET /api/v1/review/:token` — what a client sees through a review link. */
export interface ReviewView {
  project: { id: string; name: string; clientName: string | null; from: string };
  status: ReviewStatus;
  approvedBy: string | null;
  approvedAt: string | null;
  canApprove: boolean;
  version: number | null;
  config: unknown | null;
  comments: Comment[];
  expiresAt: string | null;
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
  /** Full-size stills taken for custom thumbnails. */
  frames?: { time: number; url: string }[];
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
