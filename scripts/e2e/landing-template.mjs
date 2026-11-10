// The designed "Glow Face Cream" landing page used by wp-landing.mjs, and re-applied to an existing page with
//   node scripts/e2e/landing-template.mjs --story <projectId> --product <productUrl> --woo <wooId> [--site http://development.local] [--out file.html]
// No hairline borders anywhere: smooth-scroll themes (GSAP ScrollSmoother, Lenis) move the page by fractional pixels,
// and a 1 px line then shimmers while the page glides — sections are separated by soft bands and shadows instead.
export function landingHtml({ siteUrl, storyProjectId, productUrl, wooId, date = new Date().toISOString().slice(0, 10) }) {
  return `<!-- wp:html -->
<style>
.gc{--ink:#1d1d1f;--muted:#6e6e73;--accent:#c8755a;--soft:#fbeee4;--band:#faf6f2;font-family:Inter,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--ink);line-height:1.5;-webkit-font-smoothing:antialiased}
.gc *{box-sizing:border-box}
.gc h1,.gc h2,.gc h3{font-family:Fraunces,Georgia,"Times New Roman",serif;font-weight:600;letter-spacing:-.02em;color:var(--ink);margin:0}
.gc p{margin:0}
.gc .wrap{max-width:1140px;margin:0 auto;padding:0 20px}
.gc .band{background:var(--band);border-radius:28px}
.gc .band>.wrap{padding-left:40px;padding-right:40px}
.gc .eyebrow{font-size:13px;font-weight:700;letter-spacing:.22em;text-transform:uppercase;color:var(--accent)}
.gc .hero{padding:72px 0 24px;text-align:center}
.gc .hero h1{font-size:clamp(40px,6vw,76px);line-height:1.02;margin:14px auto 18px;max-width:14ch}
.gc .hero .lead{font-size:clamp(18px,2vw,24px);color:var(--muted);max-width:52ch;margin:0 auto 26px}
.gc .actions{display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-bottom:44px}
.gc .btn{display:inline-flex;align-items:center;gap:8px;padding:14px 26px;border-radius:999px;font-weight:600;font-size:16px;text-decoration:none}
.gc .btn.primary{background:var(--ink);color:#fff}
.gc .btn.ghost{color:var(--ink);background:var(--band);box-shadow:inset 0 0 0 1.5px rgba(29,29,31,.08)}
.gc .gc-hero-video{aspect-ratio:16/9;border-radius:28px;overflow:clip;background:linear-gradient(180deg,#fff,#fbf5f0)}
.gc .benefits{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;padding:56px 0}
.gc .card{padding:28px;border-radius:22px;background:#fff;box-shadow:0 1px 2px rgba(40,20,10,.05),0 14px 36px rgba(40,20,10,.07)}
.gc .benefit b{display:block;font-family:Fraunces,Georgia,serif;font-size:44px;font-weight:600;letter-spacing:-.03em;color:var(--accent);line-height:1}
.gc .benefit p{margin-top:10px;color:var(--muted)}
.gc .story{padding:40px 0 80px}
.gc .story-head{text-align:center;max-width:62ch;margin:0 auto 36px}
.gc .story-head h2{font-size:clamp(32px,4.4vw,56px);line-height:1.05;margin:12px 0 14px}
.gc .story-head p{color:var(--muted);font-size:19px}
.gc .story-stage{background:#fff}
.gc .story-stage .sceneflow-player{max-width:1240px;margin:0 auto}
.gc .after{display:grid;grid-template-columns:1fr 1fr;gap:40px;align-items:center;padding:80px 0}
.gc .after h2{font-size:clamp(28px,3.6vw,44px);line-height:1.08;margin-bottom:14px}
.gc .after p{color:var(--muted);font-size:18px}
.gc .after ul{margin:18px 0 0;padding:0;list-style:none;display:grid;gap:10px}
.gc .after li{padding-left:28px;position:relative;font-size:17px;list-style:none}
.gc .after li::marker{content:none}
.gc .after li:before{content:"";position:absolute;left:0;top:9px;width:14px;height:14px;border-radius:50%;background:var(--soft);box-shadow:inset 0 0 0 4px var(--accent)}
.gc .ingredients{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
.gc .ing{padding:26px;border-radius:22px;background:var(--soft)}
.gc .ing h3{font-size:22px;margin-bottom:8px}
.gc .ing p{color:#5a4a42;font-size:16px}
.gc .reviews{padding:80px 40px}
.gc .reviews h2{text-align:center;font-size:clamp(28px,3.6vw,44px);margin-bottom:36px}
.gc .review-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
.gc .stars{color:var(--accent);letter-spacing:2px;font-size:14px;margin-bottom:10px}
.gc .review p{font-size:17px}
.gc .review small{display:block;margin-top:14px;color:var(--muted)}
.gc .buy{padding:88px 0;text-align:center}
.gc .buy h2{font-size:clamp(32px,4.4vw,56px);margin-bottom:12px}
.gc .price{font-family:Fraunces,Georgia,serif;font-size:40px;margin:18px 0 6px}
.gc .price s{color:#a1a1a6;font-size:26px;margin-right:12px;font-weight:400}
.gc .fine{color:var(--muted);font-size:14px;margin-top:12px}
.gc .faq{padding:72px 40px 80px;max-width:840px;margin:0 auto}
.gc .faq h2{font-size:32px;margin-bottom:18px}
.gc details{background:#fff;border-radius:16px;padding:16px 20px;margin-bottom:10px;box-shadow:0 1px 2px rgba(40,20,10,.05),0 10px 28px rgba(40,20,10,.06)}
.gc summary{cursor:pointer;font-weight:600;font-size:18px;list-style:none}
.gc details p{margin-top:10px;color:var(--muted)}
.gc footer{padding:30px 0 60px;color:var(--muted);font-size:14px;text-align:center}
@media (max-width:900px){.gc .benefits,.gc .ingredients,.gc .review-grid,.gc .after{grid-template-columns:1fr}}
</style>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Inter:wght@400;500;600;700&display=swap">
<div class="gc">
  <section class="hero wrap">
    <p class="eyebrow">New · Glow Skincare</p>
    <h1>Skin that drinks it in.</h1>
    <p class="lead">A weightless face cream with hyaluronic acid and ceramides. Twenty-four hours of hydration, nothing you can feel but softness.</p>
    <div class="actions"><a class="btn primary" href="${productUrl}">Buy — $29</a><a class="btn ghost" href="#story">See how it works</a></div>
    <div class="gc-hero-video"></div>
  </section>
  <section class="wrap benefits">
    <div class="card benefit"><b>24h</b><p>Hydration that lasts from your morning routine to the next one.</p></div>
    <div class="card benefit"><b>10 s</b><p>Absorbs completely before you have finished your coffee.</p></div>
    <div class="card benefit"><b>0 %</b><p>Fragrance, parabens, silicones. Vegan and dermatologist tested.</p></div>
  </section>
  <section class="story" id="story">
    <div class="wrap story-head"><p class="eyebrow">How it works</p><h2>Open the jar by scrolling.</h2><p>Keep scrolling — the video follows your hand, forwards and back.</p></div>
    <div class="story-stage">[sceneflow id="${storyProjectId}"]</div>
  </section>
  <section class="wrap after">
    <div><p class="eyebrow">Ingredients</p><h2>Three actives. Nothing else to think about.</h2><p>Every ingredient earns its place; the full list fits on the lid.</p><ul><li>Hyaluronic acid, three molecular weights</li><li>Ceramides NP, AP and EOP</li><li>Squalane from olives</li></ul></div>
    <div class="ingredients"><div class="ing"><h3>Hyaluronic</h3><p>Draws water into the upper layers and holds it there.</p></div><div class="ing"><h3>Ceramides</h3><p>Rebuild the barrier that keeps moisture from leaving.</p></div><div class="ing"><h3>Squalane</h3><p>A silky finish that never feels oily.</p></div></div>
  </section>
  <div class="band"><section class="reviews wrap"><h2>Loved on the first morning.</h2><div class="review-grid">
    <div class="card review"><div class="stars">★★★★★</div><p>“The first cream that did not make my skin shiny by lunch. I am on my third jar.”</p><small>Nadia R., verified buyer</small></div>
    <div class="card review"><div class="stars">★★★★★</div><p>“Sinks in instantly. My makeup sits better and lasts longer.”</p><small>Priya K., verified buyer</small></div>
    <div class="card review"><div class="stars">★★★★★</div><p>“Dry winter skin, gone in a week. Zero scent is a bonus.”</p><small>Tom A., verified buyer</small></div>
  </div></section></div>
  <section class="buy wrap"><p class="eyebrow">Launch offer</p><h2>Glow Face Cream, 50 ml</h2><p class="price"><s>$39</s>$29</p><a class="btn primary" href="${siteUrl}/?add-to-cart=${wooId}">Add to bag</a><p class="fine">Free shipping over $40 · 30-day returns · Code GLOW10 at checkout</p></section>
  <div class="band"><section class="faq wrap"><h2>Questions</h2>
    <details><summary>Is it suitable for oily skin?</summary><p>Yes. The texture is a light gel-cream that leaves a matte-soft finish.</p></details>
    <details><summary>Can I use it under makeup?</summary><p>Absolutely — wait ten seconds and apply as usual.</p></details>
    <details><summary>When will my order ship?</summary><p>Within one business day, tracked.</p></details>
  </section></div>
  <footer class="wrap">© Glow Skincare · Dummy landing page made by the SceneFlow WordPress test (${date})</footer>
</div>
<!-- /wp:html -->`;
}

// CLI (see the header). Writes the HTML to --out (default dist/e2e/landing.html) for `wp post update <id> <file>`.
const self = process.argv[1] ? new URL(`file:///${process.argv[1].replace(/\\/g, "/")}`).href : "";
if (self === import.meta.url) {
  const argv = process.argv.slice(2);
  const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const html = landingHtml({ siteUrl: flag("--site") ?? "http://development.local", storyProjectId: flag("--story"), productUrl: flag("--product"), wooId: flag("--woo") });
  const { writeFile } = await import("node:fs/promises");
  const out = flag("--out") ?? "dist/e2e/landing.html";
  await writeFile(out, html, "utf8");
  console.log(out);
}
