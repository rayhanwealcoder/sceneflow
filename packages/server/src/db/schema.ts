import { PRESET_TYPES, type BrandKit, type PresetConfig, type PresetInput, type Project } from "@sceneflow/schema";
import { bigint, boolean, doublePrecision, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

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

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  siteId: uuid("site_id").references(() => sites.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  status: text("status", { enum: ["draft", "published", "archived"] }).notNull().default("draft"),
  currentDraftVersion: integer("current_draft_version").notNull().default(0),
  publishedVersion: integer("published_version"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

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
