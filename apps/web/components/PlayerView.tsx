"use client";

import { useEffect, useRef, useState } from "react";
import { Player } from "@sceneflow/core";
import { DEVICES, type Device } from "@sceneflow/schema";

/** Runs the real published runtime on a config (used for draft preview). */
export function PlayerView({ config }: { config: unknown }) {
  const ref = useRef<HTMLDivElement>(null);
  const [device, setDevice] = useState<Device | "auto">("auto");
  const [log, setLog] = useState<string[]>([]);

  useEffect(() => {
    if (!ref.current) return;
    const player = new Player({ target: ref.current, config, lazy: false, device });
    const push = (m: string) => setLog((l) => [m, ...l].slice(0, 30));
    player.on("sceneChange", (p) => push(`scene → ${p.sceneId}`));
    player.on("actionTriggered", (p) => push(`action ${p.action.type}`));
    player.on("addToCart", (p) => push(`addToCart ${p.product.title || p.productId} ×${p.quantity} → ${p.result.ok ? "ok" : p.result.message}`));
    player.on("buyNow", (p) => push(`buyNow ${p.product.title || p.productId} ×${p.quantity}`));
    player.on("couponApplied", (p) => push(`coupon ${p.code} → ${p.result.ok ? "ok" : p.result.message}`));
    player.on("complete", () => push("complete"));
    player.on("error", (p) => push(`error ${p.code}: ${p.message}`));
    void player.init();
    return () => player.destroy();
  }, [config, device]);

  const width = device === "mobile" ? 390 : device === "tablet" ? 820 : "100%";

  return (
    <div className="stack">
      <div className="row between">
        <div className="tabs" role="tablist">
          <button className={device === "auto" ? "on" : ""} onClick={() => setDevice("auto")} type="button">
            Auto
          </button>
          {DEVICES.map((d) => (
            <button key={d} className={device === d ? "on" : ""} onClick={() => setDevice(d)} type="button">
              {d[0]!.toUpperCase() + d.slice(1)}
            </button>
          ))}
        </div>
        <span className="muted small">This is the real runtime, exactly as it runs on your website.</span>
      </div>
      <div style={{ width, maxWidth: "100%", margin: "0 auto", borderRadius: 12, overflow: "hidden", boxShadow: "0 10px 40px rgba(0,0,0,.3)" }}>
        <div ref={ref} />
      </div>
      <details>
        <summary className="small muted">Events ({log.length})</summary>
        <pre>{log.join("\n") || "—"}</pre>
      </details>
    </div>
  );
}
