import { buildApp } from "./app.js";
import { configFromEnv } from "./config.js";

const cfg = configFromEnv();
const app = await buildApp(cfg);
await app.listen({ port: cfg.port, host: "0.0.0.0" });

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    void app.close().then(() => process.exit(0));
  });
}
