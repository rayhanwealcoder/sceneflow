"use client";

import { useState } from "react";
import { setLayerTiming } from "@sceneflow/editor";
import { CANVAS_RATIOS, resolveLayer, type Action, type Layer, type ProductRef, type Scene } from "@sceneflow/schema";
import { useEditor, useScene, useSelectedLayers } from "@/lib/editorStore";
import type { MediaAsset } from "@/lib/types";
import { ColorField, Field, NumberField, SelectField, TextField, Toggle } from "./fields";
import { LayersPanel } from "./LayersPanel";
import { MediaPicker, type PickerType } from "./MediaPicker";
import { MotionEditor } from "./MotionEditor";
import { ProductField } from "./ProductField";
import { ProductPicker } from "./ProductPicker";

const str = (v: unknown, d = "") => (typeof v === "string" ? v : typeof v === "number" ? String(v) : d);
const num = (v: unknown, d: number) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : d);
const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);

export function Inspector({ workspaceId, projectId }: { workspaceId: string; projectId: string }) {
  const mode = useEditor((s) => s.mode);
  const selected = useSelectedLayers();
  return (
    <aside className="ed-side right" data-tour="inspector">
      {selected.length === 0 ? <SceneInspector workspaceId={workspaceId} /> : selected.length === 1 ? <LayerInspector layer={selected[0]!} workspaceId={workspaceId} projectId={projectId} /> : <MultiInspector count={selected.length} />}
      {mode === "advanced" && <LayersPanel />}
    </aside>
  );
}

// ---------------- scene ----------------

function SceneInspector({ workspaceId }: { workspaceId: string }) {
  const { project, updateScene, setSceneDuration, setProjectMeta, mode } = useEditor();
  const scene = useScene();
  const [picker, setPicker] = useState<PickerType | null>(null);
  const bg = scene.background;
  const baseVideo = project.video;
  const pb = project.playback;
  const setPlayback = (patch: Partial<typeof pb>) => setProjectMeta({ playback: { ...pb, ...patch } });

  const pick = (asset: MediaAsset) => {
    const m = asset.metadataJson;
    if (picker === "image") updateScene(scene.id, { background: { type: "image", assetId: asset.id, src: m.editorUrl ?? m.posterUrl } });
    else if (picker === "video" && m.proxyUrl) {
      updateScene(scene.id, { background: { type: "video", assetId: asset.id, src: m.proxyUrl, poster: m.posterUrl, sourceStart: 0, sourceEnd: m.duration } });
      if (m.duration) setSceneDuration(scene.id, m.duration);
    }
    setPicker(null);
  };

  return (
    <div className="stack" style={{ gap: 14 }}>
      <h3 className="small muted" style={{ margin: 0 }}>
        SCENE
      </h3>
      <TextField label="Name" value={scene.name} onChange={(name) => updateScene(scene.id, { name })} />
      <NumberField label="Duration" suffix="s" value={scene.end - scene.start} step={0.5} min={0.5} onChange={(d) => setSceneDuration(scene.id, d)} />
      {baseVideo && (
        <p className="muted small">
          This project plays one main video ({baseVideo.duration.toFixed(1)}s). Scenes split it into sections; this scene covers {scene.start.toFixed(1)}–{scene.end.toFixed(1)}s.
        </p>
      )}

      <SelectField<Scene["background"]["type"]>
        label="Background"
        value={bg.type}
        options={[
          { value: "video", label: baseVideo ? "Main video" : "Video clip" },
          { value: "image", label: "Image" },
          { value: "color", label: "Solid color" },
          { value: "gradient", label: "Gradient" },
        ]}
        onChange={(type) => {
          if (type === "color") updateScene(scene.id, { background: { type: "color", color: "#111827" } });
          else if (type === "gradient") updateScene(scene.id, { background: { type: "gradient", css: "linear-gradient(135deg, #4f46e5, #ec4899)" } });
          else if (type === "video" && baseVideo) updateScene(scene.id, { background: { type: "video", assetId: baseVideo.assetId, sourceStart: scene.start } });
          else setPicker(type);
        }}
      />
      {bg.type === "color" && <ColorField label="Color" value={bg.color} onChange={(color) => updateScene(scene.id, { background: { ...bg, color } })} />}
      {bg.type === "gradient" && <TextField label="CSS gradient" value={bg.css} onChange={(css) => updateScene(scene.id, { background: { ...bg, css } })} />}
      {(bg.type === "image" || (bg.type === "video" && !baseVideo)) && (
        <div className="row">
          {bg.type === "image" && bg.src ? <img src={bg.src} alt="" style={{ width: 72, height: 40, objectFit: "cover", borderRadius: 6 }} /> : null}
          {bg.type === "video" && bg.poster ? <img src={bg.poster} alt="" style={{ width: 72, height: 40, objectFit: "cover", borderRadius: 6 }} /> : null}
          <button className="btn sm" onClick={() => setPicker(bg.type === "image" ? "image" : "video")}>
            {bg.type === "image" ? (bg.src ? "Change image" : "Choose image") : bg.src ? "Change clip" : "Choose clip"}
          </button>
        </div>
      )}

      <div className="ed-grid2">
        <SelectField<Scene["transition"]["type"]>
          label="Transition"
          value={scene.transition.type}
          options={[
            { value: "none", label: "None" },
            { value: "fade", label: "Fade" },
            { value: "slide", label: "Slide" },
            { value: "zoom", label: "Zoom" },
          ]}
          onChange={(type) => updateScene(scene.id, { transition: { ...scene.transition, type } })}
        />
        <NumberField label="Length" suffix="s" value={scene.transition.duration} step={0.1} min={0} max={5} onChange={(duration) => updateScene(scene.id, { transition: { ...scene.transition, duration } })} />
      </div>

      {mode === "advanced" && (
        <>
          <h3 className="small muted" style={{ margin: "6px 0 0" }}>
            PROJECT
          </h3>
          <SelectField label="Canvas" value={project.canvas.aspectRatio} options={CANVAS_RATIOS.map((r) => ({ value: r, label: r }))} onChange={(aspectRatio) => setProjectMeta({ canvas: { aspectRatio } })} />
          <SelectField
            label="Playback"
            value={pb.mode}
            options={[
              { value: "click", label: "Click to play" },
              { value: "autoplay", label: "Autoplay (muted)" },
              { value: "normal", label: "Normal controls" },
              { value: "hover", label: "Play on hover" },
              { value: "loop", label: "Loop" },
              { value: "scroll", label: "Scroll scrub" },
            ]}
            onChange={(mode) => setPlayback({ mode })}
          />
          {pb.mode !== "scroll" && (
            <>
              <Toggle label="Show native video controls" checked={pb.controls} onChange={(controls) => setPlayback({ controls })} />
              <Toggle label="Start muted" checked={pb.muted} onChange={(muted) => setPlayback({ muted })} />
            </>
          )}
          {pb.mode === "scroll" && (
            <>
              <p className="muted small">Visitors scrub the video by scrolling the page — forwards and backwards. Audio is off in this mode.</p>
              <Toggle label="Pin the player while scrolling" checked={pb.pin} onChange={(pin) => setPlayback({ pin })} />
              <ScrollDistanceField value={pb.scrollDistance} onChange={(scrollDistance) => setPlayback({ scrollDistance })} />
              <div className="ed-grid2">
                <NumberField label="Smoothness" value={pb.smoothness} step={0.1} min={0} max={1} onChange={(smoothness) => setPlayback({ smoothness })} />
                <SelectField
                  label="Direction"
                  value={pb.scrollAxis}
                  options={[
                    { value: "vertical", label: "Vertical" },
                    { value: "horizontal", label: "Horizontal" },
                  ]}
                  onChange={(scrollAxis) => setPlayback({ scrollAxis })}
                />
                <NumberField label="Start dead zone" value={pb.startOffset} step={0.05} min={0} max={0.45} onChange={(startOffset) => setPlayback({ startOffset })} />
                <NumberField label="End dead zone" value={pb.endOffset} step={0.05} min={0} max={0.45} onChange={(endOffset) => setPlayback({ endOffset })} />
              </div>
              <Toggle label="Show progress bar" checked={pb.showProgress} onChange={(showProgress) => setPlayback({ showProgress })} />
              <SelectField
                label="On phones"
                value={pb.mobileFallback}
                options={[
                  { value: "normal", label: "Normal click-to-play" },
                  { value: "autoplay", label: "Muted autoplay" },
                  { value: "poster", label: "Poster image only" },
                  { value: "scroll", label: "Scroll scrub too" },
                ]}
                onChange={(mobileFallback) => setPlayback({ mobileFallback })}
              />
              <SelectField
                label="If visitor prefers reduced motion"
                value={pb.reducedMotion}
                options={[
                  { value: "normal", label: "Normal playback" },
                  { value: "poster", label: "Poster image only" },
                ]}
                onChange={(reducedMotion) => setPlayback({ reducedMotion })}
              />
            </>
          )}
        </>
      )}

      {picker && <MediaPicker workspaceId={workspaceId} type={picker} onPick={pick} onClose={() => setPicker(null)} />}
    </div>
  );
}

function ScrollDistanceField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  const valid = /^\d{1,4}(vh|px)$/.test(draft);
  return (
    <Field label="Scroll distance" hint="e.g. 300vh = 3 screens">
      <input className={`input sm ${valid ? "" : "invalid"}`} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => valid && draft !== value && onChange(draft)} placeholder="300vh" />
    </Field>
  );
}

// ---------------- single layer ----------------

type Tab = "content" | "style" | "layout" | "motion" | "action";

function LayerInspector({ layer, workspaceId, projectId }: { layer: Layer; workspaceId: string; projectId: string }) {
  const { device, mode, project, updateLayer, updateLayerForDevice, clearOverride, reorder, removeSelected, duplicateSelected, apply } = useEditor();
  const scene = useScene();
  const setTiming = (id: string, t: { start?: number; end?: number }) => apply((p) => setLayerTiming(p, scene.id, id, t));
  const [tab, setTab] = useState<Tab>("content");
  const [picker, setPicker] = useState<PickerType | null>(null);
  const r = resolveLayer(layer, device);
  const hasOverride = r.overridden.frame || r.overridden.style || r.overridden.hidden;
  const setStyle = (patch: Record<string, string | number>) => updateLayerForDevice(layer.id, { style: patch });
  const setContent = (patch: Record<string, string | number | boolean>) => updateLayer(layer.id, { content: { ...layer.content, ...patch } });
  const textual = layer.type === "text" || layer.type === "badge" || layer.type === "button" || layer.type === "commerce-button";
  const boxed = layer.type !== "text" && layer.type !== "hotspot" && layer.type !== "audio";
  const isAudio = layer.type === "audio";
  const isProduct = layer.type === "product";
  // A product card's button is its action, so the Action tab is not shown for it.
  const tabs: Tab[] = isAudio ? ["content", "layout"] : isProduct ? ["content", "style", "layout", "motion"] : ["content", "style", "layout", "motion", "action"];
  const activeTab: Tab = tabs.includes(tab) ? tab : "content";

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row between">
        <h3 className="small muted" style={{ margin: 0 }}>
          {(layer.name ?? layer.type).toUpperCase()}
        </h3>
        <span className="row" style={{ gap: 4 }}>
          <button className="btn sm" onClick={duplicateSelected} title="Duplicate (Ctrl+D)">
            ⧉
          </button>
          <button className="btn sm" onClick={removeSelected} title="Delete">
            ✕
          </button>
        </span>
      </div>

      {device !== "desktop" && (
        <div className={`alert small ${hasOverride ? "" : "muted"}`}>
          {hasOverride ? (
            <span className="row between">
              <span>Customized for {device}</span>
              <button className="btn sm" onClick={() => clearOverride(layer.id)}>
                Reset to desktop
              </button>
            </span>
          ) : (
            `Editing ${device}: position, size and style changes apply to ${device} only.`
          )}
        </div>
      )}

      <div className="tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t} className={activeTab === t ? "on" : ""} onClick={() => setTab(t)} type="button">
            {t[0]!.toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {activeTab === "content" && (
        <>
          {isAudio && (
            <>
              <div className="row">
                <span className="muted small">{layer.src ? "Audio file selected" : "No audio file yet"}</span>
                <button className="btn sm" onClick={() => setPicker("audio")}>
                  {layer.src ? "Change audio" : "Choose audio"}
                </button>
              </div>
              <NumberField label="Volume" value={num(layer.content.volume, 1)} step={0.05} min={0} max={1} onChange={(volume) => setContent({ volume })} />
              <p className="muted small">Plays while this element is active (see Layout → timing). Audio is silent in scroll-scrub mode and when the project starts muted.</p>
            </>
          )}
          {layer.type === "text" && (
            <>
              <TextField label="Text" multiline value={str(layer.content.text)} onChange={(text) => setContent({ text })} />
              <SelectField
                label="Align"
                value={str(r.style.textAlign, "left")}
                options={[
                  { value: "left", label: "Left" },
                  { value: "center", label: "Center" },
                  { value: "right", label: "Right" },
                ]}
                onChange={(textAlign) => setStyle({ textAlign })}
              />
            </>
          )}
          {layer.type === "badge" && <TextField label="Text" value={str(layer.content.text)} onChange={(text) => setContent({ text })} />}
          {(layer.type === "button" || layer.type === "commerce-button") && <TextField label="Label" value={str(layer.content.label)} onChange={(label) => setContent({ label })} />}
          {layer.type === "hotspot" && <TextField label="Tooltip" value={str(layer.content.tooltip)} onChange={(tooltip) => setContent({ tooltip })} />}
          {layer.type === "image" && (
            <>
              <div className="row">
                {layer.src ? <img src={layer.src} alt="" style={{ width: 72, height: 48, objectFit: "cover", borderRadius: 6 }} /> : <span className="muted small">No image yet</span>}
                <button className="btn sm" onClick={() => setPicker("image")}>
                  {layer.src ? "Change image" : "Choose image"}
                </button>
              </div>
              <TextField label="Alt text" value={str(layer.content.alt)} onChange={(alt) => setContent({ alt })} placeholder="Describe the image" />
              <SelectField
                label="Fit"
                value={str(r.style.fit, "cover")}
                options={[
                  { value: "cover", label: "Cover" },
                  { value: "contain", label: "Contain" },
                ]}
                onChange={(fit) => setStyle({ fit })}
              />
            </>
          )}
          {layer.type === "shape" && <p className="muted small">Shapes are styled on the Style tab.</p>}
          {isProduct && (
            <>
              <ProductField
                projectId={projectId}
                workspaceId={workspaceId}
                value={layer.product}
                onChange={(product) => updateLayer(layer.id, { product, name: product?.title && (!layer.name || layer.name === "Product" || layer.name === layer.product?.title) ? product.title : layer.name })}
              />
              {!layer.product && <p className="muted small">Pick a product from your shop (or add one by hand). The card shows its image, name and live price, and the button adds it to the cart.</p>}
              <SelectField
                label="Button does"
                value={str(layer.content.buttonAction, "add_to_cart")}
                options={[
                  { value: "add_to_cart", label: "Add to cart" },
                  { value: "buy_now", label: "Buy now (straight to checkout)" },
                  { value: "view", label: "Open the product page" },
                ]}
                onChange={(buttonAction) => setContent({ buttonAction })}
              />
              <TextField label="Button label" value={str(layer.content.buttonLabel)} placeholder={str(layer.content.buttonAction) === "buy_now" ? "Buy now" : str(layer.content.buttonAction) === "view" ? "View product" : "Add to cart"} onChange={(buttonLabel) => setContent({ buttonLabel })} />
              <SelectField
                label="Layout"
                value={str(layer.content.layout, "vertical")}
                options={[
                  { value: "vertical", label: "Image on top" },
                  { value: "horizontal", label: "Image on the left" },
                ]}
                onChange={(layout) => setContent({ layout })}
              />
              <div className="ed-grid2">
                <Toggle label="Image" checked={bool(layer.content.showImage, true)} onChange={(showImage) => setContent({ showImage })} />
                <Toggle label="Name" checked={bool(layer.content.showTitle, true)} onChange={(showTitle) => setContent({ showTitle })} />
                <Toggle label="Price" checked={bool(layer.content.showPrice, true)} onChange={(showPrice) => setContent({ showPrice })} />
                <Toggle label="Button" checked={bool(layer.content.showButton, true)} onChange={(showButton) => setContent({ showButton })} />
              </div>
              <Toggle label="Let visitors choose an option (size, colour…)" checked={bool(layer.content.variants, true)} onChange={(variants) => setContent({ variants })} />
              <Toggle label="Quantity selector" checked={bool(layer.content.quantity, false)} onChange={(quantity) => setContent({ quantity })} />
            </>
          )}
          {mode === "advanced" && <TextField label="Layer name" value={layer.name ?? ""} onChange={(name) => updateLayer(layer.id, { name })} />}
        </>
      )}

      {activeTab === "style" && (
        <>
          {textual && (
            <>
              <ColorField label="Text color" value={str(r.style.color, "#ffffff")} onChange={(color) => setStyle({ color })} />
              <div className="ed-grid2">
                <NumberField label="Font size" value={num(r.style.fontSize, 24)} min={6} max={300} onChange={(fontSize) => setStyle({ fontSize })} />
                <SelectField
                  label="Weight"
                  value={str(r.style.fontWeight, "700")}
                  options={["400", "500", "600", "700", "800", "900"].map((w) => ({ value: w, label: w }))}
                  onChange={(fontWeight) => setStyle({ fontWeight: Number(fontWeight) })}
                />
              </div>
              <SelectField
                label="Text shadow"
                value={str(r.style.textShadow) ? "soft" : "none"}
                options={[
                  { value: "none", label: "None" },
                  { value: "soft", label: "Soft" },
                ]}
                onChange={(v) => setStyle({ textShadow: v === "soft" ? "0 2px 12px rgba(0,0,0,.45)" : "none" })}
              />
            </>
          )}
          {boxed && <ColorField label="Background" value={str(r.style.background, "transparent")} onChange={(background) => setStyle({ background })} />}
          {layer.type === "hotspot" && <ColorField label="Dot color" value={str(r.style.color, "#ffffff")} onChange={(color) => setStyle({ color })} />}
          {isProduct && (
            <>
              <ColorField label="Text color" value={str(r.style.color, "#111111")} onChange={(color) => setStyle({ color })} />
              <ColorField label="Button color" value={str(r.style.accent, "#4f46e5")} onChange={(accent) => setStyle({ accent })} />
              <NumberField label="Text size" value={num(r.style.fontSize, 16)} min={8} max={64} onChange={(fontSize) => setStyle({ fontSize })} />
            </>
          )}
          <div className="ed-grid2">
            {boxed && <NumberField label="Corner radius" value={num(r.style.borderRadius, 0)} min={0} max={999} onChange={(borderRadius) => setStyle({ borderRadius })} />}
            <NumberField label="Opacity" value={num(r.style.opacity, 1)} step={0.05} min={0} max={1} onChange={(opacity) => setStyle({ opacity })} />
          </div>
          {mode === "advanced" && (
            <>
              <TextField label="Border" value={str(r.style.border)} onChange={(border) => setStyle({ border })} placeholder="2px solid #fff" />
              <TextField label="Shadow" value={str(r.style.boxShadow)} onChange={(boxShadow) => setStyle({ boxShadow })} placeholder="0 10px 30px rgba(0,0,0,.3)" />
            </>
          )}
        </>
      )}

      {activeTab === "layout" && (
        <>
          <div className="ed-grid2">
            <NumberField label="X" suffix="%" value={r.frame.x} step={0.5} onChange={(x) => updateLayerForDevice(layer.id, { frame: { x } })} />
            <NumberField label="Y" suffix="%" value={r.frame.y} step={0.5} onChange={(y) => updateLayerForDevice(layer.id, { frame: { y } })} />
            <NumberField label="Width" suffix="%" value={r.frame.w} step={0.5} min={1} onChange={(w) => updateLayerForDevice(layer.id, { frame: { w } })} />
            <NumberField label="Height" suffix="%" value={r.frame.h} step={0.5} min={1} onChange={(h) => updateLayerForDevice(layer.id, { frame: { h } })} />
          </div>
          <NumberField label="Rotation" suffix="°" value={r.frame.rotation} step={1} min={-180} max={180} onChange={(rotation) => updateLayerForDevice(layer.id, { frame: { rotation } })} />
          <Toggle label={`Hidden on ${device}`} checked={r.hidden} onChange={(hidden) => updateLayerForDevice(layer.id, { hidden })} />
          <Toggle label="Locked (cannot be moved on canvas)" checked={layer.locked} onChange={(locked) => updateLayer(layer.id, { locked })} />
          <div className="ed-grid4">
            <button className="btn sm" title="Send to back" onClick={() => reorder(layer.id, "bottom")}>
              ⤓
            </button>
            <button className="btn sm" title="Send backward" onClick={() => reorder(layer.id, "down")}>
              ↓
            </button>
            <button className="btn sm" title="Bring forward" onClick={() => reorder(layer.id, "up")}>
              ↑
            </button>
            <button className="btn sm" title="Bring to front" onClick={() => reorder(layer.id, "top")}>
              ⤒
            </button>
          </div>
          {(mode === "advanced" || isAudio) && (
            <>
              <h4 className="small muted" style={{ margin: "6px 0 0" }}>
                TIMING (within scene, {(scene.end - scene.start).toFixed(1)}s)
              </h4>
              <div className="ed-grid2">
                <NumberField label="Appear at" suffix="s" value={layer.start ?? 0} step={0.1} min={0} onChange={(start) => setTiming(layer.id, { start })} />
                <NumberField label="Disappear at" suffix="s" value={layer.end ?? scene.end - scene.start} step={0.1} min={0} onChange={(end) => setTiming(layer.id, { end })} />
              </div>
            </>
          )}
        </>
      )}

      {activeTab === "motion" && <MotionEditor layer={layer} onChange={(animation) => updateLayer(layer.id, { animation })} />}

      {activeTab === "action" && <ActionEditor layer={layer} scenes={project.scenes} projectId={projectId} workspaceId={workspaceId} onChange={(action) => updateLayer(layer.id, { action })} />}

      {picker && (
        <MediaPicker
          workspaceId={workspaceId}
          type={picker}
          onPick={(a) => {
            const m = a.metadataJson;
            if (picker === "audio") updateLayer(layer.id, { src: m.audioUrl, assetId: a.id, name: layer.name === "Audio" ? a.originalName.replace(/\.[^.]+$/, "") : layer.name });
            else updateLayer(layer.id, { src: m.editorUrl ?? m.posterUrl, assetId: a.id });
            setPicker(null);
          }}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}

// ---------------- actions ----------------

type ActionKind = "none" | Action["type"];
type ProductActionKind = "ADD_TO_CART" | "BUY_NOW" | "VIEW_PRODUCT";

const productAction = (kind: ProductActionKind, product: ProductRef, quantity = 1): Action => (kind === "VIEW_PRODUCT" ? { type: kind, product } : { type: kind, product, quantity });

function ActionEditor({ layer, scenes, projectId, workspaceId, onChange }: { layer: Layer; scenes: Scene[]; projectId: string; workspaceId: string; onChange: (a: Action | undefined) => void }) {
  const a = layer.action;
  const kind: ActionKind = a?.type ?? "none";
  // Product actions need a product before they can be stored; the picker opens first.
  const [pending, setPending] = useState<ProductActionKind | null>(null);
  const options: Array<{ value: ActionKind; label: string }> = [
    { value: "none", label: "Nothing" },
    { value: "OPEN_URL", label: "Open a link" },
    { value: "GO_TO_SCENE", label: "Jump to scene" },
    { value: "SEEK", label: "Jump to time" },
    { value: "TOGGLE_LAYER", label: "Show / hide an element" },
    { value: "ADD_TO_CART", label: "Add a product to the cart" },
    { value: "BUY_NOW", label: "Buy a product now" },
    { value: "VIEW_PRODUCT", label: "Open a product page" },
    { value: "APPLY_COUPON", label: "Apply a coupon" },
    { value: "OPEN_CART", label: "Open the cart" },
    { value: "OPEN_CHECKOUT", label: "Open the checkout" },
  ];
  const change = (k: ActionKind) => {
    switch (k) {
      case "none":
        return onChange(undefined);
      case "OPEN_URL":
        return onChange({ type: "OPEN_URL", url: "https://", newTab: true });
      case "GO_TO_SCENE":
        return onChange({ type: "GO_TO_SCENE", sceneId: scenes[0]!.id });
      case "SEEK":
        return onChange({ type: "SEEK", time: 0 });
      case "TOGGLE_LAYER":
        return onChange({ type: "TOGGLE_LAYER", layerId: layer.id });
      case "OPEN_CART":
      case "OPEN_CHECKOUT":
        return onChange({ type: k });
      case "ADD_TO_CART":
      case "BUY_NOW":
      case "VIEW_PRODUCT": {
        const product = a && "product" in a ? a.product : undefined;
        if (product) return onChange(productAction(k, product, a && "quantity" in a ? a.quantity : 1));
        return setPending(k);
      }
      case "APPLY_COUPON":
        return onChange({ type: "APPLY_COUPON", code: "" });
    }
  };
  const isProductAction = a?.type === "ADD_TO_CART" || a?.type === "BUY_NOW" || a?.type === "VIEW_PRODUCT";
  return (
    <div className="stack" style={{ gap: 12 }}>
      <SelectField<ActionKind> label="When clicked" value={pending ?? kind} options={options} onChange={change} />
      {a?.type === "OPEN_URL" && (
        <>
          <TextField label="URL" value={a.url} onChange={(url) => onChange({ ...a, url })} placeholder="https://yourshop.com/product/…" />
          <Toggle label="Open in a new tab" checked={a.newTab} onChange={(newTab) => onChange({ ...a, newTab })} />
          {!/^https?:\/\/[^/]+/.test(a.url) && <div className="alert error small">Enter a full link starting with https://</div>}
        </>
      )}
      {a?.type === "GO_TO_SCENE" && <SelectField label="Scene" value={a.sceneId} options={scenes.map((s) => ({ value: s.id, label: s.name }))} onChange={(sceneId) => onChange({ ...a, sceneId })} />}
      {a?.type === "SEEK" && <NumberField label="Time" suffix="s" value={a.time} step={0.1} min={0} onChange={(time) => onChange({ ...a, time })} />}
      {a?.type === "TOGGLE_LAYER" && (
        <Field label="Element">
          <select className="input sm" value={a.layerId} onChange={(e) => onChange({ ...a, layerId: e.target.value })}>
            {scenes
              .flatMap((s) => s.layers.map((l) => ({ id: l.id, label: `${s.name} · ${l.name ?? l.type}` })))
              .map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
          </select>
        </Field>
      )}
      {isProductAction && a && "product" in a && (
        <>
          <ProductField projectId={projectId} workspaceId={workspaceId} value={a.product} onChange={(product) => product && onChange({ ...a, product })} />
          {a.type !== "VIEW_PRODUCT" && <NumberField label="Quantity" value={a.quantity} min={1} max={99} onChange={(quantity) => onChange({ ...a, quantity: Math.max(1, Math.round(quantity)) })} />}
        </>
      )}
      {a?.type === "APPLY_COUPON" && (
        <>
          <TextField label="Coupon code" value={a.code} onChange={(code) => onChange({ ...a, code: code.toUpperCase().slice(0, 64) })} placeholder="SPRING10" />
          {!a.code && <div className="alert small">Enter the coupon code visitors should get.</div>}
        </>
      )}
      {(kind === "OPEN_CART" || kind === "OPEN_CHECKOUT" || kind === "APPLY_COUPON") && <p className="muted small">Runs through the shop on your site (WooCommerce, Shopify or a custom adapter).</p>}
      {pending && (
        <ProductPicker
          projectId={projectId}
          workspaceId={workspaceId}
          onPick={(product) => {
            onChange(productAction(pending, product));
            setPending(null);
          }}
          onClose={() => setPending(null)}
        />
      )}
    </div>
  );
}

// ---------------- multi ----------------

function MultiInspector({ count }: { count: number }) {
  const { align, distribute, removeSelected, duplicateSelected } = useEditor();
  return (
    <div className="stack" style={{ gap: 12 }}>
      <h3 className="small muted" style={{ margin: 0 }}>
        {count} ELEMENTS
      </h3>
      <div className="ed-grid2">
        <button className="btn sm" onClick={() => align("left")}>
          Align left
        </button>
        <button className="btn sm" onClick={() => align("right")}>
          Align right
        </button>
        <button className="btn sm" onClick={() => align("hcenter")}>
          Center ↔
        </button>
        <button className="btn sm" onClick={() => align("vcenter")}>
          Center ↕
        </button>
        <button className="btn sm" onClick={() => align("top")}>
          Align top
        </button>
        <button className="btn sm" onClick={() => align("bottom")}>
          Align bottom
        </button>
        <button className="btn sm" onClick={() => distribute("h")} disabled={count < 3}>
          Distribute ↔
        </button>
        <button className="btn sm" onClick={() => distribute("v")} disabled={count < 3}>
          Distribute ↕
        </button>
      </div>
      <div className="row">
        <button className="btn sm" onClick={duplicateSelected}>
          Duplicate
        </button>
        <button className="btn sm" onClick={removeSelected}>
          Delete
        </button>
      </div>
    </div>
  );
}
