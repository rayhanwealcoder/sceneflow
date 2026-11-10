import { createRequire } from "node:module";
import { dirname } from "node:path";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { projects, projectVersions } from "@sceneflow/server";
import type { Ctx } from "../context.js";
import { uuidRe } from "../lib/validate.js";

const runtimeFile = createRequire(import.meta.url).resolve("@sceneflow/core/runtime");

/** Public, unauthenticated surface used by the published runtime. No editor code here. */
export async function publicRoutes(app: FastifyInstance, { ctx }: { ctx: Ctx }) {
  app.get<{ Params: { id: string } }>("/p/:id.json", async (req, reply) => {
    reply.header("access-control-allow-origin", "*");
    const id = req.params.id;
    if (!uuidRe.test(id)) return reply.code(404).send({ error: "NOT_FOUND" });
    const project = await ctx.db.query.projects.findFirst({ where: eq(projects.id, id) });
    if (!project?.publishedVersion) return reply.code(404).send({ error: "NOT_PUBLISHED" });
    const version = await ctx.db.query.projectVersions.findFirst({
      where: and(eq(projectVersions.projectId, id), eq(projectVersions.version, project.publishedVersion)),
    });
    if (!version) return reply.code(404).send({ error: "NOT_PUBLISHED" });
    reply.header("cache-control", "public, max-age=60, stale-while-revalidate=600");
    reply.header("etag", `"${version.checksum}"`);
    return version.configJson;
  });

  // The runtime bundle built from packages/core (IIFE, exposes window.SceneFlow).
  await app.register(fastifyStatic, {
    root: dirname(runtimeFile),
    prefix: "/runtime/",
    decorateReply: false,
    index: false,
    list: false,
    cacheControl: true,
    maxAge: "1h",
    // core runtime + optional modules (sceneflow.shopify.min.js) + source maps
    allowedPath: (p) => p.endsWith(".min.js") || p.endsWith(".map"),
  });

  // Developer demo page: shows a published project running on the public runtime.
  app.get<{ Params: { id: string }; Querystring: { v?: string } }>("/demo/:id", async (req, reply) => {
    const id = uuidRe.test(req.params.id) ? req.params.id : "";
    // `?v=<published version>` busts the one-minute config cache, so "Open live preview" right after publishing never shows the previous version.
    const v = /^\d{1,9}$/.test(req.query.v ?? "") ? `?v=${req.query.v}` : "";
    reply.type("text/html; charset=utf-8");
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SceneFlow demo</title><style>body{margin:0;font:16px system-ui;background:#0b0b0c;color:#eee}main{max-width:900px;margin:40px auto;padding:0 16px}#player{background:#000;border-radius:12px;overflow:clip;min-height:200px}pre{background:#161618;padding:12px;border-radius:8px;overflow:auto}</style></head>
<body><main><h1>SceneFlow runtime demo</h1><div id="player"></div><h3>Events</h3><pre id="log"></pre></main>
<script src="/runtime/sceneflow.runtime.min.js"></script>
<script>
const log = (m) => { document.getElementById('log').textContent += m + "\\n"; };
const player = new SceneFlow.Player({ target: '#player', configUrl: '/p/${id}.json${v}' });
['ready','sceneChange','complete','error'].forEach((e) => player.on(e, (p) => log(e + ' ' + JSON.stringify(p ?? ''))));
player.init();
</script></body></html>`;
  });
}
