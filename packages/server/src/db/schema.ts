import { ANALYTICS_EVENTS, PRESET_TYPES, type BrandKit, type PresetConfig, type PresetInput, type Project } from "@sceneflow/schema";
import { bigint, boolean, doublePrecision, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  status: text("status", { enum: ["active", "disabled"] }).notNull().default("active"),
  createdAt: createdAt(),
});

export const sessions = pgTable("sessions", {
  /** sha256 of the cookie token; the raw token is never stored. */
  id: text("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  type: text("type", { enum: ["personal", "team"] }).notNull().default("personal"),
  planId: text("plan_id").notNull().default("free"),
  createdAt: createdAt(),
});

export const WORKSPACE_ROLES = ["viewer", "editor", "admin", "owner"] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: WORKSPACE_ROLES }).notNull().default("editor"),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] })],
);

export const sites = pgTable("sites", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  name: text("name"),
  platform: text("platform", { enum: ["wordpress", "html", "react"] }).notNull().default("wordpress"),
  connectionStatus: text("connection_status", { enum: ["pending", "connected", "error"] }).notNull().default("pending"),
  /** "pretty" = /wp-json/..., "plain" = /?rest_route=... (permalinks disabled). */
  restBase: text("rest_base", { enum: ["pretty", "plain"] }).notNull().default("pretty"),
  /** AES-256-GCM encrypted shared secret used to sign publish requests. */
  secretEncrypted: text("secret_encrypted"),
  connectorVersion: text("connector_version"),
  platformVersion: text("platform_version"),
  capabilitiesJson: jsonb("capabilities_json").$type<string[]>().notNull().default([]),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  lastError: text("last_error"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const sitePublications = pgTable(
  "site_publications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id").notNull().references(() => sites.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    status: text("status", { enum: ["ok", "failed"] }).notNull(),
    error: text("error"),
    createdAt: createdAt(),
  },
  (t) => [index("site_publications_project_idx").on(t.projectId, t.createdAt)],
);

/**
 * Review workflow of a project (doc §23: Draft → Internal Review → Client Review → Approved → Published).
 * `none` = plain draft, `changes` = a reviewer asked for changes.
 */
export const REVIEW_STATUSES = ["none", "internal", "client", "changes", "approved"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  siteId: uuid("site_id").references(() => sites.id, { onDelete: "set null" }),
  /** Agency phase: the customer this video is made for (groups projects on the dashboard; picks the brand kit). */
  clientId: uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  status: text("status", { enum: ["draft", "published", "archived"] }).notNull().default("draft"),
  currentDraftVersion: integer("current_draft_version").notNull().default(0),
  publishedVersion: integer("published_version"),
  /** When on, editors can only publish an approved, unchanged draft (admins and owners can always publish). */
  approvalRequired: boolean("approval_required").notNull().default(false),
  reviewStatus: text("review_status", { enum: REVIEW_STATUSES }).notNull().default("none"),
  reviewVersion: integer("review_version"),
  reviewUpdatedAt: timestamp("review_updated_at", { withTimezone: true }),
  approvedVersion: integer("approved_version"),
  /** Checksum of the draft that was approved; autosave edits the draft in place, so this is how "changed since approval" is detected. */
  approvedChecksum: text("approved_checksum"),
  approvedBy: text("approved_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  /** Client review link: sha256 of the token for lookup, the token encrypted so the link can be shown again. */
  reviewTokenHash: text("review_token_hash"),
  reviewTokenEncrypted: text("review_token_encrypted"),
  reviewTokenExpiresAt: timestamp("review_token_expires_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Agency clients (doc §23 "client/site/project grouping"): a customer of the workspace. */
export const clients = pgTable(
  "clients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    contactName: text("contact_name"),
    contactEmail: text("contact_email"),
    notes: text("notes"),
    /** Brand kit new videos for this client start from (falls back to the workspace default). */
    brandKitId: uuid("brand_kit_id").references(() => brandKits.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("clients_workspace_idx").on(t.workspaceId, t.name)],
);

/** Invitation links for team members (no e-mail sending needed: the admin copies the link). */
export const workspaceInvites = pgTable(
  "workspace_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    /** sha256 of the token in the link; the raw token is never stored. */
    tokenHash: text("token_hash").notNull().unique(),
    role: text("role", { enum: WORKSPACE_ROLES }).notNull().default("editor"),
    /** Optional: only this e-mail may accept. */
    email: text("email"),
    invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedBy: uuid("accepted_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("workspace_invites_workspace_idx").on(t.workspaceId, t.createdAt)],
);

export const COMMENT_SOURCES = ["team", "client"] as const;
export type CommentSource = (typeof COMMENT_SOURCES)[number];

/**
 * Review comments (doc §23: frame / scene / time anchored, mentions, resolve / reopen). Team members write
 * them in the editor; clients through the review link (`source` = client, `author_id` null).
 */
export const comments = pgTable(
  "comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id").references((): AnyPgColumn => comments.id, { onDelete: "cascade" }),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    authorName: text("author_name").notNull(),
    source: text("source", { enum: COMMENT_SOURCES }).notNull().default("team"),
    body: text("body").notNull(),
    /** Anchor: project time in seconds, scene, element, and a point on the stage in percent. All optional. */
    t: doublePrecision("t"),
    sceneId: text("scene_id"),
    layerId: text("layer_id"),
    x: doublePrecision("x"),
    y: doublePrecision("y"),
    /** User ids mentioned with @Name. */
    mentionsJson: jsonb("mentions_json").$type<string[]>().notNull().default([]),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: text("resolved_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("comments_project_idx").on(t.projectId, t.createdAt)],
);

export const ACTIVITY_TYPES = ["review_requested", "client_review_requested", "approved", "changes_requested", "review_reset", "published", "comment", "client_comment", "exported"] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

/** What happened on which project — the agency dashboard's feed and the source of its alerts. */
export const projectActivity = pgTable(
  "project_activity",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    type: text("type", { enum: ACTIVITY_TYPES }).notNull(),
    actorName: text("actor_name").notNull(),
    detail: text("detail"),
    createdAt: createdAt(),
  },
  (t) => [index("project_activity_workspace_idx").on(t.workspaceId, t.createdAt)],
);

export const projectVersions = pgTable(
  "project_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    configJson: jsonb("config_json").$type<Project>().notNull(),
    checksum: text("checksum").notNull(),
    state: text("state", { enum: ["draft", "published"] }).notNull().default("draft"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("project_versions_project_version_idx").on(t.projectId, t.version)],
);

export const PLACEMENT_MODES = ["replace", "before", "after", "append", "prepend"] as const;
export type PlacementMode = (typeof PLACEMENT_MODES)[number];

/** A player mounted into an existing element of a page on a connected site (no shortcode needed). */
export const placements = pgTable(
  "placements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    siteId: uuid("site_id").notNull().references(() => sites.id, { onDelete: "cascade" }),
    postId: integer("post_id"),
    path: text("path"),
    pageUrl: text("page_url"),
    pageTitle: text("page_title"),
    selector: text("selector").notNull(),
    mode: text("mode", { enum: PLACEMENT_MODES }).notNull().default("replace"),
    createdAt: createdAt(),
  },
  (t) => [index("placements_project_idx").on(t.projectId)],
);

/**
 * Products entered by hand ("manual" commerce provider): for sites without WooCommerce, payment
 * links, or anything the editor should show as a product card without a connected store.
 */
export const catalogProducts = pgTable(
  "catalog_products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    priceAmount: doublePrecision("price_amount").notNull(),
    regularPriceAmount: doublePrecision("regular_price_amount"),
    currency: text("currency").notNull().default("USD"),
    imageUrl: text("image_url"),
    productUrl: text("product_url"),
    inStock: boolean("in_stock").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("catalog_products_workspace_idx").on(t.workspaceId, t.updatedAt)],
);

/** Library scopes (doc 22.2). "official" presets ship with the editor and are not stored here. */
export const PRESET_LIBRARY_SCOPES = ["personal", "workspace"] as const;
export type PresetLibraryScope = (typeof PRESET_LIBRARY_SCOPES)[number];

/** Cloud preset library: elements, scenes, motions and full templates saved by users (doc §22). */
export const presets = pgTable(
  "presets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    /** Creator; personal presets are visible to this user only. */
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    scope: text("scope", { enum: PRESET_LIBRARY_SCOPES }).notNull().default("workspace"),
    type: text("type", { enum: PRESET_TYPES }).notNull(),
    name: text("name").notNull(),
    description: text("description"),
    inputsJson: jsonb("inputs_json").$type<PresetInput[]>().notNull().default([]),
    /** Bumped whenever the config changes; copies in projects remember the version they came from. */
    version: integer("version").notNull().default(1),
    configJson: jsonb("config_json").$type<PresetConfig>().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("presets_workspace_type_idx").on(t.workspaceId, t.type, t.updatedAt)],
);

/** Brand kits (doc 22.4). `client_id` is reserved for the agency phase. */
export const brandKits = pgTable(
  "brand_kits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    clientId: uuid("client_id"),
    name: text("name").notNull().default("Brand"),
    configJson: jsonb("config_json").$type<BrandKit>().notNull(),
    version: integer("version").notNull().default(1),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("brand_kits_workspace_idx").on(t.workspaceId, t.updatedAt)],
);

/**
 * Anonymous playback events (doc §24). `id` is the client's event uuid, so re-sent batches are harmless.
 * No IP addresses or personal data are stored; `session_id` is a random per-tab id.
 */
export const analyticsEvents = pgTable(
  "analytics_events",
  {
    id: text("id").primaryKey(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    version: integer("version"),
    sessionId: text("session_id").notNull(),
    type: text("type", { enum: ANALYTICS_EVENTS }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    /** Player time in seconds. */
    t: doublePrecision("t"),
    sceneId: text("scene_id"),
    layerId: text("layer_id"),
    productId: text("product_id"),
    host: text("host"),
    path: text("path"),
    device: text("device"),
    payloadJson: jsonb("payload_json").$type<Record<string, string | number | boolean>>().notNull().default({}),
  },
  (t) => [index("analytics_events_project_time_idx").on(t.projectId, t.occurredAt), index("analytics_events_project_type_idx").on(t.projectId, t.type, t.occurredAt)],
);

export const EXPORT_STATUSES = ["queued", "rendering", "ready", "failed"] as const;
export type ExportStatus = (typeof EXPORT_STATUSES)[number];
export const EXPORT_SOURCES = ["draft", "published"] as const;
export type ExportSource = (typeof EXPORT_SOURCES)[number];

/** Frozen render settings of one export (what the worker renders; shown in the UI). */
export interface ExportOptions {
  quality: "1080p" | "720p";
  width: number;
  height: number;
  fps: number;
  /** Responsive layout the layers are rendered with. */
  device: "desktop" | "tablet" | "mobile";
}

/**
 * MP4 exports (doc §31 "MP4 export"). The project JSON is frozen into the row when the export is requested
 * (autosave keeps rewriting the draft), the worker renders it frame by frame in headless Chrome and stores
 * the file under the public prefix; `storage_key` is what the API streams / redirects for the download.
 */
export const videoExports = pgTable(
  "video_exports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    requestedBy: uuid("requested_by").references(() => users.id, { onDelete: "set null" }),
    requestedByName: text("requested_by_name").notNull(),
    source: text("source", { enum: EXPORT_SOURCES }).notNull().default("draft"),
    version: integer("version").notNull(),
    checksum: text("checksum").notNull(),
    configJson: jsonb("config_json").$type<Project>().notNull(),
    optionsJson: jsonb("options_json").$type<ExportOptions>().notNull(),
    status: text("status", { enum: EXPORT_STATUSES }).notNull().default("queued"),
    progressJson: jsonb("progress_json").$type<{ stage: string; percent: number }>(),
    storageKey: text("storage_key"),
    fileName: text("file_name"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    durationSec: doublePrecision("duration_sec"),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("video_exports_project_idx").on(t.projectId, t.createdAt)],
);

export const MEDIA_TYPES = ["video", "image", "audio"] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

/** One encoded output of the renditions job (mirrors `VideoSource` in the project schema). */
export interface MediaRendition {
  src: string;
  width: number;
  height: number;
  kind: "progressive" | "scrub";
  sizeBytes: number;
}

/** A still extracted from a video at `time` seconds. */
export interface MediaFrame {
  time: number;
  url: string;
}
/** How many extracted stills an asset keeps (older ones are dropped from the list, the files stay). */
export const MAX_FRAMES = 24;

export interface MediaMetadata {
  duration?: number;
  width?: number;
  height?: number;
  codec?: string;
  hasAudio?: boolean;
  /** Public URLs of derived files. The original is never exposed publicly. */
  proxyUrl?: string;
  posterUrl?: string;
  editorUrl?: string;
  /** Web-friendly audio (AAC) for audio uploads. */
  audioUrl?: string;
  /** JSON with normalized peaks for timeline waveforms. */
  waveformUrl?: string;
  thumbnails?: string[];
  /** Full-size stills the editor asked for (custom thumbnails), newest last; at most `MAX_FRAMES`. */
  frames?: MediaFrame[];
  /** Current processing step, for the UI ("Encoding 1080p…"). */
  progress?: { stage: string; percent: number };
  /**
   * Device renditions (720p/1080p + scroll-optimized MP4) produced by the slower second job.
   * The asset is "ready" for editing as soon as the proxy exists; renditions arrive later.
   */
  renditions?: { status: "pending" | "ready" | "failed" | "skipped"; items: MediaRendition[]; error?: string };
}

export const mediaAssets = pgTable("media_assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  /** Storage key of the original file. */
  providerAssetId: text("provider_asset_id").notNull(),
  type: text("type", { enum: MEDIA_TYPES }).notNull(),
  originalName: text("original_name").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  status: text("status", { enum: ["pending", "uploaded", "processing", "ready", "failed"] }).notNull().default("pending"),
  metadataJson: jsonb("metadata_json").$type<MediaMetadata>().notNull().default({}),
  error: text("error"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
