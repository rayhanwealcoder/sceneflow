import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { catalogProducts, ManualCatalog, manualToProduct, projects, sites, WooCommerceCatalog, type CatalogProvider, type CatalogProviderInfo } from "@sceneflow/server";
import { z } from "zod";
import { HttpError, type Ctx } from "../context.js";
import { requireMember, requireUser } from "../lib/auth.js";
import { connectorErrorMessage, connectorSite } from "../lib/sites.js";
import { assertUuid, parseBody } from "../lib/validate.js";

/*
 * Commerce catalogs for the editor's product picker. Which providers a project can use depends on
 * its site: WooCommerce when the connected site reports that capability, "manual" always.
 */

const httpUrl = z.string().url().max(1000).refine((u) => /^https?:\/\//i.test(u), "Must start with http(s)://");
const manualProductSchema = z.object({
  name: z.string().trim().min(1).max(200),
  priceAmount: z.number().min(0).max(1e9),
  regularPriceAmount: z.number().min(0).max(1e9).nullable().optional(),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Use a 3-letter currency code").default("USD"),
  imageUrl: httpUrl.nullable().optional(),
  productUrl: httpUrl.nullable().optional(),
  inStock: z.boolean().default(true),
});

export async function commerceRoutes(app: FastifyInstance, { ctx }: { ctx: Ctx }) {
  async function providersFor(userId: string, projectId: string): Promise<{ workspaceId: string; providers: CatalogProvider[] }> {
    assertUuid(projectId, "project id");
    const project = await ctx.db.query.projects.findFirst({ where: eq(projects.id, projectId) });
    if (!project) throw new HttpError(404, "PROJECT_NOT_FOUND", "Project not found");
    await requireMember(ctx, userId, project.workspaceId);
    const providers: CatalogProvider[] = [];
    if (project.siteId) {
      const site = await ctx.db.query.sites.findFirst({ where: eq(sites.id, project.siteId) });
      if (site?.secretEncrypted && site.capabilitiesJson.includes("woocommerce")) providers.push(new WooCommerceCatalog(ctx.connector, connectorSite(ctx, site), site.name));
    }
    providers.push(new ManualCatalog(ctx.db, project.workspaceId));
    return { workspaceId: project.workspaceId, providers };
  }

  /** Which catalogs this project can pick products from. */
  app.get<{ Params: { id: string } }>("/api/v1/projects/:id/commerce", async (req) => {
    const user = await requireUser(ctx, req);
    const { providers } = await providersFor(user.id, req.params.id);
    const info: CatalogProviderInfo[] = providers.map((p) => ({ id: p.id, label: p.label, editable: p.id === "manual" }));
    return { providers: info, default: info[0]!.id };
  });

  app.get<{ Params: { id: string }; Querystring: { provider?: string; search?: string; page?: string } }>("/api/v1/projects/:id/products", async (req) => {
    const user = await requireUser(ctx, req);
    const { providers } = await providersFor(user.id, req.params.id);
    const provider = providers.find((p) => p.id === (req.query.provider ?? providers[0]!.id));
    if (!provider) throw new HttpError(404, "PROVIDER_NOT_AVAILABLE", "That product source is not available for this project");
    try {
      const page = await provider.search({ search: req.query.search?.slice(0, 100), page: Math.max(1, Number(req.query.page) || 1) });
      return { provider: provider.id, ...page };
    } catch (err) {
      throw new HttpError(502, "CATALOG_REQUEST_FAILED", connectorErrorMessage(err));
    }
  });

  app.get<{ Params: { id: string; pid: string }; Querystring: { provider?: string } }>("/api/v1/projects/:id/products/:pid", async (req) => {
    const user = await requireUser(ctx, req);
    const { providers } = await providersFor(user.id, req.params.id);
    const provider = providers.find((p) => p.id === (req.query.provider ?? providers[0]!.id));
    if (!provider) throw new HttpError(404, "PROVIDER_NOT_AVAILABLE", "That product source is not available for this project");
    try {
      const product = await provider.get(req.params.pid.slice(0, 64));
      if (!product) throw new HttpError(404, "PRODUCT_NOT_FOUND", "Product not found");
      return { provider: provider.id, product };
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(502, "CATALOG_REQUEST_FAILED", connectorErrorMessage(err));
    }
  });

  /* ---------- manual products (workspace level) ---------- */

  app.get<{ Querystring: { workspaceId?: string; search?: string } }>("/api/v1/products", async (req) => {
    const user = await requireUser(ctx, req);
    const workspaceId = assertUuid(req.query.workspaceId ?? "", "workspaceId");
    await requireMember(ctx, user.id, workspaceId);
    return new ManualCatalog(ctx.db, workspaceId).search({ search: req.query.search?.slice(0, 100) });
  });

  app.post<{ Querystring: { workspaceId?: string } }>("/api/v1/products", async (req, reply) => {
    const user = await requireUser(ctx, req);
    const body = parseBody(manualProductSchema.extend({ workspaceId: z.string().uuid() }), req.body);
    await requireMember(ctx, user.id, body.workspaceId, "editor");
    const { workspaceId, ...fields } = body;
    const [row] = await ctx.db
      .insert(catalogProducts)
      .values({ workspaceId, ...fields, regularPriceAmount: fields.regularPriceAmount ?? null, imageUrl: fields.imageUrl ?? null, productUrl: fields.productUrl ?? null })
      .returning();
    return reply.code(201).send({ product: manualToProduct(row!) });
  });

  app.patch<{ Params: { id: string } }>("/api/v1/products/:id", async (req) => {
    const user = await requireUser(ctx, req);
    const id = assertUuid(req.params.id, "product id");
    const row = await ctx.db.query.catalogProducts.findFirst({ where: eq(catalogProducts.id, id) });
    if (!row) throw new HttpError(404, "PRODUCT_NOT_FOUND", "Product not found");
    await requireMember(ctx, user.id, row.workspaceId, "editor");
    const body = parseBody(manualProductSchema.partial(), req.body);
    const [updated] = await ctx.db
      .update(catalogProducts)
      .set({ ...body, updatedAt: new Date() })
      .where(and(eq(catalogProducts.id, id), eq(catalogProducts.workspaceId, row.workspaceId)))
      .returning();
    return { product: manualToProduct(updated!) };
  });

  app.delete<{ Params: { id: string } }>("/api/v1/products/:id", async (req) => {
    const user = await requireUser(ctx, req);
    const id = assertUuid(req.params.id, "product id");
    const row = await ctx.db.query.catalogProducts.findFirst({ where: eq(catalogProducts.id, id) });
    if (!row) throw new HttpError(404, "PRODUCT_NOT_FOUND", "Product not found");
    await requireMember(ctx, user.id, row.workspaceId, "editor");
    await ctx.db.delete(catalogProducts).where(eq(catalogProducts.id, id));
    return { ok: true };
  });
}
