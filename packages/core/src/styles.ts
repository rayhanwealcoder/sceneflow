/** Runtime CSS, injected once per document. Kept tiny; everything scales with --sf-scale (stage width / 1280). */
export const RUNTIME_CSS = `
.sf-player{position:relative;width:100%;background:#000;overflow:hidden;color:#fff}
.sf-media,.sf-stage{position:absolute;inset:0}
.sf-media>video,.sf-media>img{width:100%;height:100%;object-fit:cover;display:block}
.sf-stage{--sf-scale:1;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;pointer-events:none}
.sf-layer{position:absolute;box-sizing:border-box;pointer-events:auto;transform-origin:center}
.sf-layer[data-sf-action]{cursor:pointer}
.sf-text{white-space:pre-wrap;overflow:hidden;line-height:1.15;display:flex;flex-direction:column;justify-content:center}
.sf-text[data-align=center]{text-align:center}.sf-text[data-align=right]{text-align:right}
.sf-badge,.sf-button{display:flex;align-items:center;justify-content:center;text-align:center;line-height:1}
.sf-button{border:0;font:inherit;padding:0;appearance:none}
.sf-image{display:block;width:100%;height:100%;object-fit:cover}
.sf-hotspot{border:0;background:transparent;padding:0;color:#fff}
.sf-hotspot .sf-dot{position:absolute;inset:0;border-radius:50%;background:currentColor;opacity:.95;animation:sf-pulse 1.6s ease-out infinite}
.sf-hotspot .sf-tip{position:absolute;left:50%;bottom:115%;transform:translateX(-50%);background:#111;color:#fff;padding:.45em .75em;border-radius:6px;font-size:calc(14px*var(--sf-scale));white-space:nowrap;opacity:0;pointer-events:none;transition:opacity .15s}
.sf-hotspot:hover .sf-tip,.sf-hotspot:focus-visible .sf-tip{opacity:1}
.sf-product{--sf-accent:#4f46e5;display:flex;flex-direction:column;overflow:hidden;background:#fff;color:#111;border-radius:calc(12px*var(--sf-scale));font-size:calc(16px*var(--sf-scale));box-shadow:0 10px 30px rgba(0,0,0,.25);text-align:left}
.sf-product[data-layout=horizontal]{flex-direction:row}
.sf-product-img{flex:1 1 0;min-height:0;width:100%;object-fit:cover;display:block}
.sf-product[data-layout=horizontal] .sf-product-img{width:42%;height:100%;flex:none}
.sf-product-body{display:flex;flex:1 1 auto;flex-direction:column;gap:.35em;padding:.75em;min-width:0;min-height:0}
.sf-product-title{font-weight:700;line-height:1.2;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.sf-product-price{display:flex;gap:.5em;align-items:baseline;font-weight:600;flex-wrap:wrap}
.sf-price-old{opacity:.6;font-weight:400}
.sf-product[data-sf-stock=out] .sf-product-price::after{content:"Sold out";font-size:.75em;font-weight:600;color:#b91c1c}
.sf-product-variant,.sf-product-qty{font:inherit;font-size:.9em;padding:.35em .5em;border:1px solid rgba(0,0,0,.18);border-radius:.4em;background:#fff;color:inherit;max-width:100%;box-sizing:border-box}
.sf-product-qty{width:4em}
.sf-product-actions{display:flex;gap:.5em;align-items:center;margin-top:auto}
.sf-product-btn{flex:1;border:0;font:inherit;font-weight:700;padding:.6em .9em;border-radius:.5em;background:var(--sf-accent);color:#fff;cursor:pointer;line-height:1.1}
.sf-product-btn:disabled{opacity:.55;cursor:default}
.sf-layer[data-sf-busy] .sf-product-btn{cursor:progress}
.sf-toast{position:absolute;left:50%;bottom:8%;transform:translateX(-50%);background:rgba(17,17,17,.92);color:#fff;padding:.6em 1em;border-radius:999px;font:600 14px/1.3 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;display:flex;gap:.75em;align-items:center;z-index:6;max-width:90%;box-shadow:0 10px 30px rgba(0,0,0,.35);animation:sf-toast .25s ease-out}
.sf-toast[data-kind=error]{background:rgba(185,28,28,.95)}
.sf-toast a{color:#a5b4fc;text-decoration:none;white-space:nowrap}
.sf-placeholder{display:none}
.sf-stage.sf-editing .sf-placeholder{display:flex;align-items:center;justify-content:center;border:1px dashed rgba(255,255,255,.7);color:#fff;font-size:calc(14px*var(--sf-scale));background:rgba(0,0,0,.25)}
.sf-stage.sf-editing .sf-layer{pointer-events:none}
.sf-play{position:absolute;inset:0;margin:auto;width:72px;height:72px;border-radius:50%;border:0;background:rgba(0,0,0,.55);color:#fff;font-size:28px;cursor:pointer;display:grid;place-items:center;transition:transform .15s,opacity .2s;z-index:5}
.sf-play:hover{transform:scale(1.06)}
.sf-player[data-sf-state=playing] .sf-play{opacity:0;pointer-events:none}
.sf-scroll{position:relative;width:100%}
.sf-player.sf-pinned{position:sticky;top:0}
.sf-progress{position:absolute;left:0;right:0;bottom:0;height:4px;background:rgba(255,255,255,.25);z-index:5}
.sf-progress>i{display:block;height:100%;width:0;background:#fff}
.sf-captions{--sf-scale:1;position:absolute;left:50%;bottom:7%;transform:translateX(-50%);max-width:84%;box-sizing:border-box;background:rgba(0,0,0,.72);color:#fff;padding:.3em .7em;border-radius:.3em;font:600 calc(24px*var(--sf-scale))/1.3 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;text-align:center;text-shadow:0 1px 2px rgba(0,0,0,.6);white-space:pre-wrap;z-index:4;pointer-events:none}
.sf-captions:empty{display:none}
.sf-captions[data-sf-pos=top]{top:6%;bottom:auto}
.sf-captions[data-sf-size=s]{font-size:calc(19px*var(--sf-scale))}
.sf-captions[data-sf-size=l]{font-size:calc(30px*var(--sf-scale))}
.sf-captions[data-sf-controls]{bottom:14%}
.sf-player[data-sf-cc=off] .sf-captions{display:none}
.sf-cc{position:absolute;right:10px;top:10px;z-index:6;border:1px solid rgba(255,255,255,.6);background:rgba(0,0,0,.55);color:#fff;font:700 11px/1 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;letter-spacing:.5px;padding:5px 6px;border-radius:4px;cursor:pointer}
.sf-cc[aria-pressed=false]{opacity:.5;text-decoration:line-through}
@keyframes sf-pulse{0%{box-shadow:0 0 0 0 rgba(255,255,255,.55)}100%{box-shadow:0 0 0 calc(16px*var(--sf-scale)) rgba(255,255,255,0)}}
@keyframes sf-toast{from{opacity:0;transform:translate(-50%,8px)}to{opacity:1;transform:translate(-50%,0)}}
@media (prefers-reduced-motion:reduce){.sf-hotspot .sf-dot{animation:none}.sf-toast{animation:none}}
`;

/**
 * Loads Google Fonts families a project asked for (brand kit opt-in). One stylesheet per family, added once
 * per document; names are restricted by the schema to letters, digits and spaces.
 */
export function ensureFonts(families: readonly string[] | undefined, doc: Document = document): void {
  if (!families?.length) return;
  for (const family of families) {
    if (!/^[A-Za-z0-9 ]{2,60}$/.test(family)) continue;
    const id = "sf-font-" + family.toLowerCase().replace(/\s+/g, "-");
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
