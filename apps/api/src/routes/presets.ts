import { and, desc, eq, ne, or } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { brandKitSchema, MAX_PRESET_BYTES, PRESET_INPUTS, PRESET_TYPES, presetConfigSchema, type PresetConfig } from "@sceneflow/schema";
import { brandKits, PRESET_LIBRARY_SCOPES, presets } from "@sceneflow/server";
import { z } from "zod";
import { HttpError, type Ctx } from "../context.js";
import { requireMember, requireUser, roleAtLeast } from "../lib/auth.js";
import { assertUuid, parseBody } from "../lib/validate.js";

/*
 * Cloud preset library + brand kits (doc §22). Official presets live in @sceneflow/editor (code), so the
 * API only stores what users save. Changing a preset's content bumps its version; projects keep the
 * version they copied from and the editor offers the update — nothing is pushed into projects.
 */

const name = z.string().trim().min(1).max(80);
const description = z.string().trim().max(300);
const scope = z.enum(PRESET_LIBRARY_SCOPES);
const inputs = z.array(z.enum(PRESET_INPUTS)).max(5);

const createPresetSchema = z.object({ workspaceId: z.string().uuid(), name, description: description.optional(), scope: scope.default("workspace"), inputs: inputs.default([]), config: z.unknown() });
const patchPresetSchema = z.object({ name: name.optional(), description: description.nullable().optional(), scope: scope.optional(), inputs: inputs.optional(), config: z.unknown().optional() });

const createKitSchema = z.object({ workspaceId: z.string().uuid(), name: name.default("Brand"), config: z.unknown().default({}) });
const patchKitSchema = z.object({ name: name.optional(), config: z.unknown().optional(), isDefault: z.literal(true).optional() });

function parsePresetConfig(input: unknown): PresetConfig {
  const r = presetConfigSchema.safeParse(input);
  if (!r.success) throw new HttpError(400, "INVALID_PRESET", "Preset content failed validation", r.error.issues);
  if (JSON.stringify(r.data).length > MAX_PRESET_BYTES) throw new HttpError(400, "PRESET_TOO_LARGE", `Preset exceeds ${MAX_PRESET_BYTES / 1024} KB`);
  return r.data;
}

type PresetRow = typeof presets.$inferSelect;
type KitRow = typeof brandKits.$inferSelect;

const toPreset = (row: PresetRow, userId: string) => ({
  id: row.id,
  workspaceId: row.workspaceId,
  type: row.type,
  scope: row.scope,
  name: row.name,
  description: row.description ?? undefined,
  inputs: row.inputsJson,
  version: row.version,
  config: row.configJson,
  mine: row.userId === userId,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const toKit = (row: KitRow) => ({ id: row.id, workspaceId: row.workspaceId, name: row.name, config: row.configJson, version: row.version, isDefault: row.isDefault, createdAt: row.createdAt, updatedAt: row.updatedAt });

export async function presetRoutes(app: FastifyInstance, { ctx }: { ctx: Ctx }) {
  /** Loads a preset the user may change: editors can edit workspace presets; personal ones only their creator (or an admin). */
  async function editablePreset(userId: string, id: string): Promise<PresetRow> {
    assertUuid(id, "preset id");
    const row = await ctx.db.query.presets.findFirst({ where: eq(presets.id, id) });
    if (!row) throw new HttpError(404, "PRESET_NOT_FOUND", "Preset not found");
    const role = await requireMember(ctx, userId, row.workspaceId, "editor");
    if (row.scope === "personal" && row.userId !== userId && !roleAtLeast(role, "admin")) throw new HttpError(403, "FORBIDDEN", "This preset belongs to someone else");
    return row;
  }

  app.get<{ Querystring: { workspaceId?: string; type?: string } }>("/api/v1/presets", async (req) => {
    const user = await requireUser(ctx, req);
    const workspaceId = assertUuid(req.query.workspaceId ?? "", "workspaceId");
    await requireMember(ctx, user.id, workspaceId);
    const type = PRESET_TYPES.find((t) => t === req.query.type);
    const visible = or(eq(presets.scope, "workspace"), and(eq(presets.scope, "personal"), eq(presets.userId, user.id)));
    const rows = await ctx.db
      .select()
      .from(presets)
      .where(and(eq(presets.workspaceId, workspaceId), visible, type ? eq(presets.type, type) : undefined))
      .orderBy(desc(presets.updatedAt));
    return { presets: rows.map((r) => toPreset(r, user.id)) };
  });

  app.post("/api/v1/presets", async (req, reply) => {
    const user = await requireUser(ctx, req);
    const body = parseBody(createPresetSchema, req.body);
    await requireMember(ctx, user.id, body.workspaceId, "editor");
    const config = parsePresetConfig(body.config);
    const [row] = await ctx.db
      .insert(presets)
      .values({ workspaceId: body.workspaceId, userId: user.id, scope: body.scope, type: config.type, name: body.name, description: body.description ?? null, inputsJson: body.inputs, configJson: config })
      .returning();
    return reply.code(201).send({ preset: toPreset(row!, user.id) });
  });

  /** Rename / re-scope / replace content. Replacing the content is a new version (doc 22.3). */
  app.patch<{ Params: { id: string } }>("/api/v1/presets/:id", async (req) => {
    const user = await requireUser(ctx, req);
    const row = await editablePreset(user.id, req.params.id);
    const body = parseBody(patchPresetSchema, req.body);
    const patch: Partial<typeof presets.$inferInsert> = { updatedAt: new Date() };
    if (body.name !== undefined) patch.name = body.name;
    if (body.description !== undefined) patch.description = body.description;
    if (body.scope !== undefined) patch.scope = body.scope;
    if (body.inputs !== undefined) patch.inputsJson = body.inputs;
    if (body.config !== undefined) {
      const config = parsePresetConfig(body.config);
      if (config.type !== row.type) throw new HttpError(400, "PRESET_TYPE_MISMATCH", `This is a ${row.type} preset; it cannot become a ${config.type} preset`);
      patch.configJson = config;
      patch.version = row.version + 1;
    }
    const [updated] = await ctx.db.update(presets).set(patch).where(eq(presets.id, row.id)).returning();
    return { preset: toPreset(updated!, user.id) };
  });

  app.delete<{ Params: { id: string } }>("/api/v1/presets/:id", async (req) => {
    const user = await requireUser(ctx, req);
    const row = await editablePreset(user.id, req.params.id);
    await ctx.db.delete(presets).where(eq(presets.id, row.id));
    return { ok: true };
  });

  /* ---------- brand kits ---------- */

  app.get<{ Querystring: { workspaceId?: string } }>("/api/v1/brand-kits", async (req) => {
    const user = await requireUser(ctx, req);
    const workspaceId = assertUuid(req.query.workspaceId ?? "", "workspaceId");
    await requireMember(ctx, user.id, workspaceId);
    const rows = await ctx.db.select().from(brandKits).where(eq(brandKits.workspaceId, workspaceId)).orderBy(desc(brandKits.isDefault), desc(brandKits.updatedAt));
    return { kits: rows.map(toKit) };
  });

  app.post("/api/v1/brand-kits", async (req, reply) => {
    const user = await requireUser(ctx, req);
    const body = parseBody(createKitSchema, req.body);
    await requireMember(ctx, user.id, body.workspaceId, "editor");
    const parsed = brandKitSchema.safeParse(body.config);
    if (!parsed.success) throw new HttpError(400, "INVALID_BRAND_KIT", "Brand kit failed validation", parsed.error.issues);
    const existing = await ctx.db.query.brandKits.findFirst({ where: eq(brandKits.workspaceId, body.workspaceId) });
    const [row] = await ctx.db.insert(brandKits).values({ workspaceId: body.workspaceId, name: body.name, configJson: parsed.data, isDefault: !existing }).returning();
    return reply.code(201).send({ kit: toKit(row!) });
  });

  app.patch<{ Params: { id: string } }>("/api/v1/brand-kits/:id", async (req) => {
    const user = await requireUser(ctx, req);
    const id = assertUuid(req.params.id, "brand kit id");
    const row = await ctx.db.query.brandKits.findFirst({ where: eq(brandKits.id, id) });
    if (!row) throw new HttpError(404, "BRAND_KIT_NOT_FOUND", "Brand kit not found");
    await requireMember(ctx, user.id, row.workspaceId, "editor");
    const body = parseBody(patchKitSchema, req.body);
    const patch: Partial<typeof brandKits.$inferInsert> = { updatedAt: new Date() };
    if (body.name !== undefined) patch.name = body.name;
    if (body.config !== undefined) {
      const parsed = brandKitSchema.safeParse(body.config);
      if (!parsed.success) throw new HttpError(400, "INVALID_BRAND_KIT", "Brand kit failed validation", parsed.error.issues);
      patch.configJson = parsed.data;
      patch.version = row.version + 1;
    }
    const updated = await ctx.db.transaction(async (tx) => {
      if (body.isDefault) {
        await tx.update(brandKits).set({ isDefault: false }).where(and(eq(brandKits.workspaceId, row.workspaceId), ne(brandKits.id, row.id)));
        patch.isDefault = true;
      }
      const [u] = await tx.update(brandKits).set(patch).where(eq(brandKits.id, row.id)).returning();
      return u!;
    });
    return { kit: toKit(updated) };
  });

  app.delete<{ Params: { id: string } }>("/api/v1/brand-kits/:id", async (req) => {
    const user = await requireUser(ctx, req);
    const id = assertUuid(req.params.id, "brand kit id");
    const row = await ctx.db.query.brandKits.findFirst({ where: eq(brandKits.id, id) });
    if (!row) throw new HttpError(404, "BRAND_KIT_NOT_FOUND", "Brand kit not found");
    await requireMember(ctx, user.id, row.workspaceId, "editor");
    await ctx.db.transaction(async (tx) => {
      await tx.delete(brandKits).where(eq(brandKits.id, row.id));
      if (row.isDefault) {
        const next = await tx.query.brandKits.findFirst({ where: eq(brandKits.workspaceId, row.workspaceId), orderBy: desc(brandKits.updatedAt) });
        if (next) await tx.update(brandKits).set({ isDefault: true }).where(eq(brandKits.id, next.id));
      }
    });
    return { ok: true };
  });
}
