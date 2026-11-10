// Renders a professional-looking product clip (and a matching product still) with the installed Chrome — no stock
// footage, no network: a cream jar built from CSS, a soft studio glow, rising hydration droplets, a lid that lifts
// to show the cream, a light sweep. Every frame is a pure function of time, captured over the DevTools protocol and
// encoded with FFmpeg (H.264 + an ambient pad synthesised by FFmpeg), so the result is deterministic and HD.
//
//   node scripts/e2e/make-demo-clip.mjs [out.mp4] [--still out.png] [--seconds 12] [--size 1920x1080]
// or   import { makeDemoClip, makeProductStill } from "./make-demo-clip.mjs"
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { chromium } from "playwright-core";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const FFMPEG = createRequire(resolve(ROOT, "apps/worker/package.json"))("@ffmpeg-installer/ffmpeg").path;
const exec = promisify(execFile);

/** The scene. `window.__clip.frame(t)` lays everything out for time t (seconds); nothing animates on its own. */
function sceneHtml({ width, height, product, accent, still }) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>clip</title>
<style>
html,body{margin:0;width:${width}px;height:${height}px;overflow:hidden;background:#fff}
*{transition:none!important;animation:none!important}
.bg{position:absolute;inset:0;background:#fff}
.glow{position:absolute;inset:-20%;background:radial-gradient(closest-side,rgba(246,224,208,.95),rgba(252,243,236,.6) 45%,rgba(255,255,255,0) 72%);transform-origin:center}
.stage{position:absolute;inset:0;perspective:1800px}
.jar{position:absolute;left:50%;top:50%;width:${Math.round(height * 0.34)}px;height:${Math.round(height * 0.5)}px;transform-style:preserve-3d}
.body{position:absolute;left:0;right:0;bottom:0;height:68%;border-radius:12% 12% 14% 14% / 9% 9% 11% 11%;background:linear-gradient(90deg,#e9dccf 0%,#f8f1ea 22%,#fffaf6 42%,#f3e8de 68%,#dccabb 100%);box-shadow:inset 0 -18px 30px rgba(120,90,70,.12),inset 0 10px 18px rgba(255,255,255,.9),0 30px 60px -30px rgba(90,60,40,.35)}
.body:before{content:"";position:absolute;left:8%;top:6%;width:10%;height:70%;border-radius:999px;background:linear-gradient(180deg,rgba(255,255,255,.95),rgba(255,255,255,.1));filter:blur(2px)}
.label{position:absolute;left:14%;right:14%;top:30%;height:36%;border-radius:8px;background:rgba(255,255,255,.55);box-shadow:0 1px 0 rgba(255,255,255,.8),inset 0 0 0 1px rgba(170,130,110,.18);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.5em;font-family:Georgia,"Times New Roman",serif;color:#5a4034}
.label b{font-size:${Math.round(height * 0.034)}px;letter-spacing:.32em;font-weight:600;text-transform:uppercase;margin-left:.32em}
.label i{font-style:normal;font-size:${Math.round(height * 0.015)}px;letter-spacing:.22em;text-transform:uppercase;opacity:.7;margin-left:.22em;white-space:nowrap}
.label u{text-decoration:none;width:34%;height:1px;background:rgba(90,64,52,.35)}
.cream{position:absolute;left:4%;right:4%;top:24%;height:16%;border-radius:50%;background:radial-gradient(ellipse at 40% 35%,#fffdfa 0%,#fbf3ec 45%,#efe0d3 100%);box-shadow:inset 0 -6px 14px rgba(150,110,90,.18)}
.cream:after{content:"";position:absolute;inset:18% 22%;border-radius:50%;background:conic-gradient(from 200deg,rgba(255,255,255,0),rgba(255,255,255,.9),rgba(255,255,255,0) 60%);filter:blur(3px)}
.lid{position:absolute;left:-2%;right:-2%;top:16%;height:22%;border-radius:14% 14% 10% 10% / 40% 40% 24% 24%;background:linear-gradient(90deg,#b8775f 0%,#d99b84 18%,#f4c9b4 38%,#e9b09a 58%,#c58169 82%,#a86a55 100%);box-shadow:inset 0 6px 10px rgba(255,255,255,.55),inset 0 -10px 16px rgba(110,60,40,.35),0 18px 30px -16px rgba(120,70,50,.5);transform-origin:50% 100%}
.lid:after{content:"";position:absolute;left:10%;right:10%;top:12%;height:22%;border-radius:999px;background:linear-gradient(90deg,rgba(255,255,255,0),rgba(255,255,255,.75),rgba(255,255,255,0))}
.shadow{position:absolute;left:50%;top:50%;width:${Math.round(height * 0.5)}px;height:${Math.round(height * 0.07)}px;margin-left:-${Math.round(height * 0.25)}px;border-radius:50%;background:radial-gradient(ellipse,rgba(90,60,45,.42),rgba(90,60,45,0) 70%);filter:blur(10px)}
.reflect{position:absolute;left:50%;top:50%;width:${Math.round(height * 0.34)}px;height:${Math.round(height * 0.5)}px;transform-style:preserve-3d;opacity:.22;-webkit-mask-image:linear-gradient(180deg,rgba(0,0,0,.6),rgba(0,0,0,0) 45%);mask-image:linear-gradient(180deg,rgba(0,0,0,.6),rgba(0,0,0,0) 45%)}
.drop{position:absolute;border-radius:50%;background:radial-gradient(circle at 35% 30%,rgba(255,255,255,.95),rgba(205,228,247,.75) 40%,rgba(170,205,240,.25) 70%,rgba(170,205,240,0) 100%);filter:blur(1px)}
.sweep{position:absolute;left:-30%;top:-30%;width:26%;height:160%;background:linear-gradient(90deg,rgba(255,255,255,0),rgba(255,255,255,.85),rgba(255,255,255,0));transform:rotate(18deg);mix-blend-mode:screen;opacity:0}
.petal{position:absolute;width:${Math.round(height * 0.06)}px;height:${Math.round(height * 0.11)}px;border-radius:100% 0 100% 0;background:linear-gradient(135deg,#f9d9cb,#edb9a5);opacity:.9;filter:blur(.4px)}
</style></head><body>
<div class="bg"><div class="glow" id="glow"></div></div>
<div class="stage" id="stage">
  <div class="shadow" id="shadow"></div>
  <div class="reflect" id="reflect"><div class="body"><div class="label"><b>${product.split(" ")[0]}</b></div></div></div>
  <div class="jar" id="jar">
    <div class="body"><div class="label"><b>${product.split(" ")[0]}</b><u></u><i>${product.split(" ").slice(1).join(" ") || "face cream"} · 50 ml</i></div></div>
    <div class="cream"></div>
    <div class="lid" id="lid"></div>
  </div>
  <div class="sweep" id="sweep"></div>
</div>
<script>
(function(){
  var W=${width},H=${height},STILL=${still ? "true" : "false"};
  var $=function(id){return document.getElementById(id)};
  var clamp=function(v,a,b){return v<a?a:v>b?b:v};
  var ss=function(a,b,t){var x=clamp((t-a)/(b-a),0,1);return x*x*(3-2*x)}; // smoothstep
  var ease=function(a,b,t){var x=clamp((t-a)/(b-a),0,1);return 1-Math.pow(1-x,3)}; // ease-out cubic
  var stage=$('stage'),drops=[],petals=[];
  var rnd=function(seed){return function(){seed=(seed*9301+49297)%233280;return seed/233280}}(7);
  for(var i=0;i<14;i++){var d=document.createElement('div');d.className='drop';var s=H*(0.02+rnd()*0.05);d.style.width=d.style.height=s+'px';drops.push({el:d,x:0.18+rnd()*0.64,y0:1.05+rnd()*0.4,v:0.09+rnd()*0.08,ph:rnd()*6.28,s:s});stage.insertBefore(d,$('jar'))}
  for(var j=0;j<3;j++){var p=document.createElement('div');p.className='petal';petals.push({el:p,x:0.12+j*0.36,y:0.78+j*0.05,r:20+j*70,sp:0.6+j*0.3});stage.appendChild(p)}
  function frame(t){
    // Composition: centred jar that slowly comes closer, then drifts right and opens; a light sweep; glow breathing.
    var cx=STILL?0:0.5*(ss(4,7.5,t)*0.19*W); // px right of centre
    var scale=STILL?1.18:1.02+0.1*ease(0,4,t)+0.08*ss(4,7.5,t);
    var ry=STILL?-8:(-7+14*ss(0,6,t))-4*ss(6,12,t);
    var lift=STILL?0:H*0.16*ss(4.6,6.4,t)*(1-0.15*ss(9,12,t));
    var tilt=STILL?0:-16*ss(4.6,6.4,t)+4*ss(8,12,t);
    var jar=$('jar');
    jar.style.transform='translate(-50%,-50%) translate3d('+cx.toFixed(2)+'px,'+(-H*0.02).toFixed(2)+'px,0) rotateY('+ry.toFixed(2)+'deg) scale('+scale.toFixed(4)+')';
    $('lid').style.transform='translate3d(0,'+(-lift).toFixed(2)+'px,0) rotateX('+tilt.toFixed(2)+'deg) rotateZ('+(tilt*0.25).toFixed(2)+'deg)';
    var ref=$('reflect');
    ref.style.transform='translate(-50%,-50%) translate3d('+cx.toFixed(2)+'px,'+(H*0.5*scale-H*0.02+H*0.06).toFixed(2)+'px,0) rotateY('+ry.toFixed(2)+'deg) scale('+scale.toFixed(4)+',-'+scale.toFixed(4)+')';
    var sh=$('shadow');
    sh.style.transform='translate3d('+cx.toFixed(2)+'px,'+(H*0.25*scale-H*0.015).toFixed(2)+'px,0) scale('+(scale*1.05).toFixed(3)+','+(1+lift/H).toFixed(3)+')';
    sh.style.opacity=(0.9-0.25*ss(4.6,6.4,t)).toFixed(3);
    var g=$('glow');
    var gx=0.5+(STILL?0:0.07*ss(4,8,t)),gy=0.52;
    g.style.transform='translate('+((gx-0.5)*W).toFixed(1)+'px,'+((gy-0.5)*H).toFixed(1)+'px) scale('+(0.95+0.08*Math.sin(t*0.9)+0.12*ss(8,12,t)).toFixed(3)+')';
    g.style.opacity=(0.85+0.15*ss(8,12,t)).toFixed(3);
    for(var i=0;i<drops.length;i++){var d=drops[i];var y=d.y0-d.v*t*0.35;var life=STILL?0:ss(0.6,2.2,t)*(1-ss(9.5,11.8,t));var sway=Math.sin(t*0.8+d.ph)*0.012;d.el.style.transform='translate3d('+((d.x+sway)*W-d.s/2).toFixed(1)+'px,'+(y*H).toFixed(1)+'px,0)';d.el.style.opacity=(life*clamp((1.1-y)*2.2,0,1)*0.9).toFixed(3)}
    for(var j=0;j<petals.length;j++){var p=petals[j];var vis=STILL?0:ss(5.2+j*0.4,6.6+j*0.4,t)*(1-ss(10.5,11.9,t));p.el.style.transform='translate3d('+(p.x*W).toFixed(1)+'px,'+((p.y-0.06*ease(5.2,12,t)*p.sp)*H).toFixed(1)+'px,0) rotate('+(p.r+t*6*p.sp).toFixed(1)+'deg)';p.el.style.opacity=(vis*0.85).toFixed(3)}
    var sw=$('sweep');var sp=ss(7.6,9.6,t);
    sw.style.opacity=(STILL?0:Math.sin(sp*Math.PI)*0.75).toFixed(3);
    sw.style.transform='translate3d('+(sp*1.6*W).toFixed(1)+'px,0,0) rotate(18deg)';
    return new Promise(function(r){requestAnimationFrame(function(){requestAnimationFrame(r)})});
  }
  window.__clip={frame:frame};
})();
</script></body></html>`;
}

const parseSize = (s) => {
  const m = /^(\d+)x(\d+)$/.exec(s ?? "");
  return m ? { width: Number(m[1]), height: Number(m[2]) } : { width: 1920, height: 1080 };
};

/**
 * Renders the clip to `out` (H.264 + ambient pad). Returns { frames, ms }.
 */
export async function makeDemoClip({ out, width = 1920, height = 1080, fps = 30, seconds = 12, product = "Glow Face Cream", accent = "#c8755a", quiet = false } = {}) {
  await mkdir(dirname(out), { recursive: true });
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--hide-scrollbars", "--force-device-scale-factor=1"] });
  const started = Date.now();
  const frames = Math.round(seconds * fps);
  try {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await page.setContent(sceneHtml({ width, height, product, accent, still: false }), { waitUntil: "load" });
    await page.evaluate("window.__clip.frame(0)");
    // Soft ambient pad: a slow major-seventh swell under a low-pass filter, faded in and out — synthesised, royalty-free.
    const pad = `aevalsrc=exprs='0.11*sin(2*PI*174.61*t)*(0.6+0.4*sin(2*PI*0.11*t))+0.08*sin(2*PI*261.63*t)*(0.6+0.4*sin(2*PI*0.09*t+1))+0.06*sin(2*PI*329.63*t)*(0.6+0.4*sin(2*PI*0.13*t+2))+0.045*sin(2*PI*392*t)*(0.5+0.5*sin(2*PI*0.07*t+3))+0.03*sin(2*PI*523.25*t)*(0.5+0.5*sin(2*PI*0.05*t+4))':s=48000:d=${seconds}`;
    const enc = spawn(
      FFMPEG,
      [
        "-hide_banner", "-loglevel", "error", "-y",
        "-f", "image2pipe", "-framerate", String(fps), "-c:v", "mjpeg", "-i", "pipe:0",
        "-f", "lavfi", "-i", pad,
        "-af", `afade=t=in:d=1.6,afade=t=out:st=${(seconds - 1.8).toFixed(2)}:d=1.8,lowpass=f=1600,volume=0.9`,
        "-map", "0:v", "-map", "1:a",
        "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p", "-profile:v", "high", "-g", String(fps), "-r", String(fps),
        "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-shortest", "-movflags", "+faststart", out,
      ],
      { stdio: ["pipe", "ignore", "pipe"], windowsHide: true },
    );
    let err = "";
    enc.stderr.on("data", (d) => (err += d.toString()));
    enc.stdin.on("error", () => {});
    const exit = new Promise((r) => enc.on("close", r));
    const cdp = await context.newCDPSession(page);
    for (let i = 0; i < frames; i++) {
      if (enc.exitCode !== null) throw new Error("ffmpeg stopped: " + err.slice(-400));
      await page.evaluate(`window.__clip.frame(${(i / fps).toFixed(4)})`);
      const shot = await cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 95, clip: { x: 0, y: 0, width, height, scale: 1 }, captureBeyondViewport: false, fromSurface: true });
      if (!enc.stdin.write(Buffer.from(shot.data, "base64"))) await once(enc.stdin, "drain");
      if (!quiet && i % (fps * 2) === 0) process.stdout.write(`  clip: ${i}/${frames} frames\r`);
    }
    enc.stdin.end();
    const code = await exit;
    if (code !== 0) throw new Error(`ffmpeg failed (${code}): ${err.slice(-400)}`);
    await cdp.detach().catch(() => {});
  } finally {
    await browser.close().catch(() => {});
  }
  return { frames, ms: Date.now() - started };
}

/** A matching product still (PNG, square, white background) for the shop product / cards. */
export async function makeProductStill({ out, size = 1000, product = "Glow Face Cream", accent = "#c8755a" } = {}) {
  await mkdir(dirname(out), { recursive: true });
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--hide-scrollbars", "--force-device-scale-factor=1"] });
  try {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(sceneHtml({ width: size, height: size, product, accent, still: true }), { waitUntil: "load" });
    await page.evaluate("window.__clip.frame(1.5)");
    await page.screenshot({ path: out, type: "png", clip: { x: 0, y: 0, width: size, height: size } });
  } finally {
    await browser.close().catch(() => {});
  }
  return out;
}

/** ffprobe-free sanity check used by the e2e scripts: file exists and is not tiny. */
export async function fileSize(path) {
  const { stat } = await import("node:fs/promises");
  return (await stat(path)).size;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const args = process.argv.slice(2);
  const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const out = resolve(args.find((a) => a.endsWith(".mp4")) ?? "dist/e2e/demo-clip.mp4");
  const { width, height } = parseSize(flag("--size"));
  const r = await makeDemoClip({ out, width, height, seconds: Number(flag("--seconds") ?? 12) });
  console.log(`\nclip: ${out} (${r.frames} frames in ${(r.ms / 1000).toFixed(1)} s, ${(await fileSize(out) / 1024).toFixed(0)} KB)`);
  const still = flag("--still");
  if (still) console.log(`still: ${await makeProductStill({ out: resolve(still) })}`);
  // Keep ffprobe-free; the e2e scripts probe the result themselves.
  void exec;
}
