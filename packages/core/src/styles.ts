/** Runtime CSS, injected once per document. Kept tiny; everything scales with --sceneflow-scale (stage width / 1280). */
export const RUNTIME_CSS = `
.sceneflow-root{position:relative;width:100%;background:#000;overflow:hidden;color:#fff}
.sceneflow-media,.sceneflow-stage{position:absolute;inset:0}
.sceneflow-media>video,.sceneflow-media>img{width:100%;height:100%;object-fit:cover;display:block}
.sceneflow-stage{--sceneflow-scale:1;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;pointer-events:none}
.sceneflow-layer{position:absolute;box-sizing:border-box;pointer-events:auto;transform-origin:center}
.sceneflow-layer[data-sceneflow-action]{cursor:pointer}
.sceneflow-text{white-space:pre-wrap;overflow:hidden;line-height:1.15;display:flex;flex-direction:column;justify-content:center}
.sceneflow-text[data-align=center]{text-align:center}.sceneflow-text[data-align=right]{text-align:right}
.sceneflow-badge,.sceneflow-button{display:flex;align-items:center;justify-content:center;text-align:center;line-height:1}
.sceneflow-button{border:0;font:inherit;padding:0;appearance:none}
.sceneflow-image{display:block;width:100%;height:100%;object-fit:cover}
.sceneflow-hotspot{border:0;background:transparent;padding:0;color:#fff}
.sceneflow-hotspot .sceneflow-dot{position:absolute;inset:0;border-radius:50%;background:currentColor;opacity:.95;animation:sceneflow-pulse 1.6s ease-out infinite}
.sceneflow-hotspot .sceneflow-tip{position:absolute;left:50%;bottom:115%;transform:translateX(-50%);background:#111;color:#fff;padding:.45em .75em;border-radius:6px;font-size:calc(14px*var(--sceneflow-scale));white-space:nowrap;opacity:0;pointer-events:none;transition:opacity .15s}
.sceneflow-hotspot:hover .sceneflow-tip,.sceneflow-hotspot:focus-visible .sceneflow-tip{opacity:1}
.sceneflow-product{--sceneflow-accent:#4f46e5;display:flex;flex-direction:column;overflow:hidden;background:#fff;color:#111;border-radius:calc(12px*var(--sceneflow-scale));font-size:calc(16px*var(--sceneflow-scale));box-shadow:0 10px 30px rgba(0,0,0,.25);text-align:left}
.sceneflow-product[data-layout=horizontal]{flex-direction:row}
.sceneflow-product-img{flex:1 1 0;min-height:0;width:100%;object-fit:cover;display:block}
.sceneflow-product[data-layout=horizontal] .sceneflow-product-img{width:42%;height:100%;flex:none}
.sceneflow-product-body{display:flex;flex:1 1 auto;flex-direction:column;gap:.35em;padding:.75em;min-width:0;min-height:0}
.sceneflow-product-title{font-weight:700;line-height:1.2;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.sceneflow-product-price{display:flex;gap:.5em;align-items:baseline;font-weight:600;flex-wrap:wrap}
.sceneflow-price-old{opacity:.6;font-weight:400}
.sceneflow-product[data-sceneflow-stock=out] .sceneflow-product-price::after{content:"Sold out";font-size:.75em;font-weight:600;color:#b91c1c}
.sceneflow-product-variant,.sceneflow-product-qty{font:inherit;font-size:.9em;padding:.35em .5em;border:1px solid rgba(0,0,0,.18);border-radius:.4em;background:#fff;color:inherit;max-width:100%;box-sizing:border-box}
.sceneflow-product-qty{width:4em}
.sceneflow-product-actions{display:flex;gap:.5em;align-items:center;margin-top:auto}
.sceneflow-product-btn{flex:1;border:0;font:inherit;font-weight:700;padding:.6em .9em;border-radius:.5em;background:var(--sceneflow-accent);color:#fff;cursor:pointer;line-height:1.1}
.sceneflow-product-btn:disabled{opacity:.55;cursor:default}
.sceneflow-layer[data-sceneflow-busy] .sceneflow-product-btn{cursor:progress}
.sceneflow-toast{position:absolute;left:50%;bottom:8%;transform:translateX(-50%);background:rgba(17,17,17,.92);color:#fff;padding:.6em 1em;border-radius:999px;font:600 14px/1.3 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;display:flex;gap:.75em;align-items:center;z-index:6;max-width:90%;box-shadow:0 10px 30px rgba(0,0,0,.35);animation:sceneflow-toast .25s ease-out}
.sceneflow-toast[data-kind=error]{background:rgba(185,28,28,.95)}
.sceneflow-toast a{color:#a5b4fc;text-decoration:none;white-space:nowrap}
.sceneflow-placeholder{display:none}
.sceneflow-stage.sceneflow-editing .sceneflow-placeholder{display:flex;align-items:center;justify-content:center;border:1px dashed rgba(255,255,255,.7);color:#fff;font-size:calc(14px*var(--sceneflow-scale));background:rgba(0,0,0,.25)}
.sceneflow-stage.sceneflow-editing .sceneflow-layer{pointer-events:none}
.sceneflow-play{position:absolute;inset:0;margin:auto;width:72px;height:72px;border-radius:50%;border:0;background:rgba(0,0,0,.55);color:#fff;font-size:28px;cursor:pointer;display:grid;place-items:center;transition:transform .15s,opacity .2s;z-index:5}
.sceneflow-play:hover{transform:scale(1.06)}
.sceneflow-root[data-sceneflow-state=playing] .sceneflow-play{opacity:0;pointer-events:none}
.sceneflow-scroll{position:relative;width:100%}
.sceneflow-root[data-sceneflow-pin=sticky]{position:sticky;top:0}
.sceneflow-root[data-sceneflow-pin=transform]{will-change:transform}
.sceneflow-root[data-sceneflow-pin=fixed][data-sceneflow-pin-phase=pinned]{z-index:1}
.sceneflow-progress{position:absolute;left:0;right:0;bottom:0;height:4px;background:rgba(255,255,255,.25);z-index:5}
.sceneflow-progress>i{display:block;height:100%;width:0;background:#fff}
.sceneflow-captions{--sceneflow-scale:1;position:absolute;left:50%;bottom:7%;transform:translateX(-50%);max-width:84%;box-sizing:border-box;background:rgba(0,0,0,.72);color:#fff;padding:.3em .7em;border-radius:.3em;font:600 calc(24px*var(--sceneflow-scale))/1.3 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;text-align:center;text-shadow:0 1px 2px rgba(0,0,0,.6);white-space:pre-wrap;z-index:4;pointer-events:none}
.sceneflow-captions:empty{display:none}
.sceneflow-captions[data-sceneflow-pos=top]{top:6%;bottom:auto}
.sceneflow-captions[data-sceneflow-size=s]{font-size:calc(19px*var(--sceneflow-scale))}
.sceneflow-captions[data-sceneflow-size=l]{font-size:calc(30px*var(--sceneflow-scale))}
.sceneflow-captions[data-sceneflow-controls]{bottom:14%}
.sceneflow-root[data-sceneflow-cc=off] .sceneflow-captions{display:none}
.sceneflow-cc{position:absolute;right:10px;top:10px;z-index:6;border:1px solid rgba(255,255,255,.6);background:rgba(0,0,0,.55);color:#fff;font:700 11px/1 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;letter-spacing:.5px;padding:5px 6px;border-radius:4px;cursor:pointer}
.sceneflow-cc[aria-pressed=false]{opacity:.5;text-decoration:line-through}
@keyframes sceneflow-pulse{0%{box-shadow:0 0 0 0 rgba(255,255,255,.55)}100%{box-shadow:0 0 0 calc(16px*var(--sceneflow-scale)) rgba(255,255,255,0)}}
@keyframes sceneflow-toast{from{opacity:0;transform:translate(-50%,8px)}to{opacity:1;transform:translate(-50%,0)}}
@media (prefers-reduced-motion:reduce){.sceneflow-hotspot .sceneflow-dot{animation:none}.sceneflow-toast{animation:none}}
`;

/**
 * Loads Google Fonts families a project asked for (brand kit opt-in). One stylesheet per family, added once
 * per document; names are restricted by the schema to letters, digits and spaces.
 */
export function ensureFonts(families: readonly string[] | undefined, doc: Document = document): void {
  if (!families?.length) return;
  for (const family of families) {
    if (!/^[A-Za-z0-9 ]{2,60}$/.test(family)) continue;
    const id = "sceneflow-font-" + family.toLowerCase().replace(/\s+/g, "-");
    if (doc.getElementById(id)) continue;
    const link = doc.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=" + encodeURIComponent(family).replace(/%20/g, "+") + ":wght@400;500;600;700;800;900&display=swap";
    doc.head.appendChild(link);
  }
}

let injected = false;
export function ensureStyles(doc: Document = document): void {
  if (injected || doc.querySelector("style[data-sceneflow]")) {
    injected = true;
    return;
  }
  const style = doc.createElement("style");
  style.dataset.sceneflow = "runtime";
  style.textContent = RUNTIME_CSS;
  doc.head.appendChild(style);
  injected = true;
}
