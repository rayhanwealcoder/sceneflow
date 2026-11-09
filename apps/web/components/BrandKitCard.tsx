"use client";

import { useEffect, useState } from "react";
import { FONT_OPTIONS, googleFamilies } from "@sceneflow/editor";
import { DEFAULT_BRAND_KIT, type BrandKit } from "@sceneflow/schema";
import { ensureFonts } from "@sceneflow/core";
import { ColorField, NumberField, SelectField, TextField, Toggle } from "@/components/editor/fields";
import { MediaPicker } from "@/components/editor/MediaPicker";
import { api, errorMessage } from "@/lib/api";
import type { BrandKitRow } from "@/lib/types";

/**
 * Brand kit (doc 22.4): colours, fonts, logo, button and card style set once per workspace. New videos
 * and new elements follow it automatically; existing videos get an "Apply brand kit" in the editor.
 */
export function BrandKitCard({ workspaceId }: { workspaceId: string }) {
  const [kits, setKits] = useState<BrandKitRow[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = () =>
    api<{ kits: BrandKitRow[] }>(`/api/v1/brand-kits?workspaceId=${workspaceId}`)
      .then((r) => setKits(r.kits))
      .catch((e) => setError(errorMessage(e)));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  const kit = kits?.find((k) => k.isDefault) ?? kits?.[0] ?? null;
  useEffect(() => {
    if (kit) ensureFonts(googleFamilies(kit.config));
  }, [kit]);

  if (kits === null) return null;

  if (editing) {
    return (
      <BrandKitForm
        workspaceId={workspaceId}
        existing={kit}
        onDone={(changed) => {
          setEditing(false);
          setSaved(changed);
          void load();
        }}
      />
    );
  }

  return (
    <section className="card stack" id="brand">
      <div className="row between">
        <h2 style={{ margin: 0 }}>Brand kit</h2>
        <button className="btn sm" onClick={() => setEditing(true)}>
          {kit ? "Edit" : "Set up brand kit"}
        </button>
      </div>
      {error && <div className="alert error small">{error}</div>}
      {saved && <div className="alert ok small">Saved. New videos use it automatically; for an existing video open the editor and choose ⋯ → Apply brand kit.</div>}
      {kit ? (
        <div className="row" style={{ gap: 16 }}>
          {kit.config.logo && <img className="brand-logo" src={kit.config.logo.src} alt="Logo" />}
          <span className="row" style={{ gap: 6 }} title="Primary and secondary colours">
            <i className="brand-swatch" style={{ background: kit.config.colors.primary }} />
            <i className="brand-swatch" style={{ background: kit.config.colors.secondary }} />
            <i className="brand-swatch" style={{ background: kit.config.colors.surface }} />
          </span>
          <span className="small" style={{ fontFamily: kit.config.fonts.heading || undefined, fontWeight: 700 }}>
            {FONT_OPTIONS.find((f) => f.family === kit.config.fonts.heading)?.label ?? (kit.config.fonts.heading ? "Custom font" : "Site font")}
          </span>
          <span className="small muted">
            {kit.name} · buttons {kit.config.button.borderRadius >= 999 ? "pill" : `${kit.config.button.borderRadius}px corners`}
            {kit.config.button.textTransform === "uppercase" ? " · UPPERCASE" : ""} · v{kit.version}
          </span>
        </div>
      ) : (
        <p className="muted small" style={{ margin: 0 }}>
          Set your colours, fonts and logo once (2 minutes). Every new video and every element you add will match your brand — no styling by hand.
        </p>
      )}
    </section>
  );
}

const FONT_FAMILIES = FONT_OPTIONS.map((f) => f.family);

function BrandKitForm({ workspaceId, existing, onDone }: { workspaceId: string; existing: BrandKitRow | null; onDone: (changed: boolean) => void }) {
  const [name, setName] = useState(existing?.name ?? "My brand");
  const [kit, setKit] = useState<BrandKit>(existing?.config ?? DEFAULT_BRAND_KIT);
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const patch = (p: Partial<BrandKit>) => setKit((k) => ({ ...k, ...p }));
  const google = googleFamilies(kit);
  useEffect(() => {
    ensureFonts(google);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kit.fonts.heading, kit.fonts.body]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (existing) await api(`/api/v1/brand-kits/${existing.id}`, { method: "PATCH", json: { name, config: kit } });
      else await api("/api/v1/brand-kits", { method: "POST", json: { workspaceId, name, config: kit } });
      onDone(true);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  const fontField = (label: string, key: "heading" | "body") => {
    const value = kit.fonts[key];
    const custom = value !== "" && !FONT_FAMILIES.includes(value);
    return (
      <div className="stack" style={{ gap: 6 }}>
        <SelectField label={label} value={custom ? "__custom" : value} options={[...FONT_OPTIONS.map((f) => ({ value: f.family, label: f.label })), { value: "__custom", label: "Custom (type the CSS font-family)" }]} onChange={(v) => patch({ fonts: { ...kit.fonts, [key]: v === "__custom" ? (custom ? value : "MyFont, sans-serif") : v } })} />
        {custom && <TextField label={`${label} font-family`} value={value} onChange={(v) => patch({ fonts: { ...kit.fonts, [key]: v } })} placeholder='"My Font", sans-serif' />}
        <p className="small" style={{ margin: 0, fontFamily: value || undefined, fontWeight: key === "heading" ? 800 : 500, fontSize: key === "heading" ? 22 : 15 }}>
          {key === "heading" ? "Headline preview" : "Body text preview — the quick brown fox"}
        </p>
      </div>
    );
  };

  return (
    <section className="card stack" id="brand">
      <div className="row between">
        <h2 style={{ margin: 0 }}>{existing ? "Edit brand kit" : "Set up your brand kit"}</h2>
        <button className="btn sm" onClick={() => onDone(false)}>
          Cancel
        </button>
      </div>
      <TextField label="Kit name" value={name} onChange={setName} placeholder="My brand" />

      <h3 className="small muted" style={{ margin: "6px 0 0" }}>
        LOGO
      </h3>
      <div className="row">
        {kit.logo ? <img className="brand-logo" src={kit.logo.src} alt="Logo" /> : <span className="muted small">No logo yet</span>}
        <button className="btn sm" onClick={() => setPicker(true)}>
          {kit.logo ? "Change logo" : "Choose logo"}
        </button>
        {kit.logo && (
          <button
            className="btn sm"
            onClick={() => {
              const { logo: _l, ...rest } = kit;
              setKit(rest as BrandKit);
            }}
          >
            Remove
          </button>
        )}
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        Used by the “Logo in the corner” preset and any element named “Logo”. PNG or SVG with transparency works best.
      </p>

      <h3 className="small muted" style={{ margin: "6px 0 0" }}>
        COLOURS
      </h3>
      <div className="brand-grid">
        <ColorField label="Primary (buttons, product card button, hotspots)" value={kit.colors.primary} onChange={(primary) => patch({ colors: { ...kit.colors, primary } })} />
        <ColorField label="Secondary (badges)" value={kit.colors.secondary} onChange={(secondary) => patch({ colors: { ...kit.colors, secondary } })} />
        <ColorField label="Card background (product card)" value={kit.colors.surface} onChange={(surface) => patch({ colors: { ...kit.colors, surface } })} />
        <ColorField label="Card text" value={kit.colors.surfaceText} onChange={(surfaceText) => patch({ colors: { ...kit.colors, surfaceText } })} />
      </div>

      <h3 className="small muted" style={{ margin: "6px 0 0" }}>
        FONTS
      </h3>
      <div className="brand-grid">
        {fontField("Headings", "heading")}
        {fontField("Body and buttons", "body")}
      </div>
      {google.length > 0 && (
        <>
          <Toggle label={`Load ${google.join(" and ")} from Google Fonts on my site`} checked={kit.fonts.loadGoogleFonts} onChange={(loadGoogleFonts) => patch({ fonts: { ...kit.fonts, loadGoogleFonts } })} />
          <p className="muted small" style={{ margin: 0 }}>
            Off: the font only shows if your site already loads it (most themes do). On: visitors’ browsers fetch it from fonts.googleapis.com — mention it in your privacy policy if you serve EU visitors.
          </p>
        </>
      )}

      <h3 className="small muted" style={{ margin: "6px 0 0" }}>
        BUTTONS AND CARDS
      </h3>
      <div className="brand-grid">
        <SelectField
          label="Button corners"
          value={kit.button.borderRadius >= 999 ? "pill" : kit.button.borderRadius === 0 ? "square" : "rounded"}
          options={[
            { value: "rounded", label: "Rounded" },
            { value: "pill", label: "Pill" },
            { value: "square", label: "Square" },
          ]}
          onChange={(v) => patch({ button: { ...kit.button, borderRadius: v === "pill" ? 999 : v === "square" ? 0 : 10 } })}
        />
        <SelectField
          label="Button text"
          value={kit.button.textTransform}
          options={[
            { value: "none", label: "As written" },
            { value: "uppercase", label: "UPPERCASE" },
          ]}
          onChange={(textTransform) => patch({ button: { ...kit.button, textTransform } })}
        />
        <SelectField label="Button weight" value={String(kit.button.fontWeight)} options={["500", "600", "700", "800", "900"].map((w) => ({ value: w, label: w }))} onChange={(w) => patch({ button: { ...kit.button, fontWeight: Number(w) } })} />
        <NumberField label="Card / image corners" suffix="px" value={kit.radius} min={0} max={60} onChange={(radius) => patch({ radius })} />
        <SelectField
          label="Shadow"
          value={kit.shadow}
          options={[
            { value: "none", label: "None" },
            { value: "soft", label: "Soft" },
            { value: "strong", label: "Strong" },
          ]}
          onChange={(shadow) => patch({ shadow })}
        />
      </div>
      <div className="row" style={{ gap: 12 }}>
        <span className="small muted">Preview:</span>
        <span style={{ display: "inline-block", padding: "10px 18px", background: kit.colors.primary, color: "#fff", borderRadius: Math.min(kit.button.borderRadius, 40), fontWeight: kit.button.fontWeight, textTransform: kit.button.textTransform, fontFamily: kit.fonts.body || undefined, boxShadow: kit.shadow === "none" ? undefined : "0 10px 30px rgba(0,0,0,.25)" }}>
          Add to cart
        </span>
        <span style={{ display: "inline-block", padding: "4px 12px", background: kit.colors.secondary, color: "#fff", borderRadius: 999, fontWeight: 800, fontSize: 13, fontFamily: kit.fonts.body || undefined }}>
          NEW
        </span>
        <span style={{ display: "inline-block", padding: "8px 12px", background: kit.colors.surface, color: kit.colors.surfaceText, borderRadius: Math.min(kit.radius, 40), fontFamily: kit.fonts.body || undefined, fontWeight: 700, fontSize: 13 }}>
          Product card
        </span>
      </div>

      {error && <div className="alert error small">{error}</div>}
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button className="btn primary" onClick={() => void save()} disabled={busy}>
          {busy ? "Saving…" : existing ? "Save changes" : "Save brand kit"}
        </button>
      </div>

      {picker && (
        <MediaPicker
          workspaceId={workspaceId}
          type="image"
          onPick={(a) => {
            const src = a.metadataJson.editorUrl ?? a.metadataJson.posterUrl;
            if (src) patch({ logo: { assetId: a.id, src } });
            setPicker(false);
          }}
          onClose={() => setPicker(false)}
        />
      )}
    </section>
  );
}
