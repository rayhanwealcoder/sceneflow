"use client";

import { ANIMATION_TYPES, type AnimationSpec, type AnimationType, type Layer } from "@sceneflow/schema";
import { NumberField, SelectField } from "./fields";

const LABELS: Record<AnimationType, string> = {
  fade: "Fade",
  "slide-up": "Slide up",
  "slide-down": "Slide down",
  "slide-left": "Slide left",
  "slide-right": "Slide right",
  zoom: "Zoom",
};
type Kind = "none" | AnimationType;
const options: Array<{ value: Kind; label: string }> = [{ value: "none", label: "None" }, ...ANIMATION_TYPES.map((t) => ({ value: t, label: LABELS[t] }))];

function Block({ title, spec, onChange, withDelay }: { title: string; spec: AnimationSpec | undefined; onChange: (s: AnimationSpec | undefined) => void; withDelay: boolean }) {
  return (
    <div className="stack" style={{ gap: 8 }}>
      <h4 className="small muted" style={{ margin: 0 }}>
        {title}
      </h4>
      <SelectField<Kind> label="Effect" value={spec?.type ?? "none"} options={options} onChange={(v) => onChange(v === "none" ? undefined : { type: v, duration: spec?.duration ?? 0.5, delay: spec?.delay ?? 0 })} />
      {spec && (
        <div className="ed-grid2">
          <NumberField label="Duration" suffix="s" value={spec.duration} step={0.1} min={0.05} max={5} onChange={(duration) => onChange({ ...spec, duration })} />
          {withDelay && <NumberField label="Delay" suffix="s" value={spec.delay} step={0.1} min={0} max={10} onChange={(delay) => onChange({ ...spec, delay })} />}
        </div>
      )}
    </div>
  );
}

export function MotionEditor({ layer, onChange }: { layer: Layer; onChange: (a: Layer["animation"]) => void }) {
  const anim = layer.animation ?? {};
  const set = (patch: Partial<NonNullable<Layer["animation"]>>) => {
    const next = { ...anim, ...patch };
    onChange(next.in || next.out ? next : undefined);
  };
  return (
    <div className="stack" style={{ gap: 14 }}>
      <Block title="ENTER" spec={anim.in} onChange={(s) => set({ in: s })} withDelay />
      <Block title="EXIT" spec={anim.out} onChange={(s) => set({ out: s })} withDelay={false} />
      <p className="muted small">Motion is driven by time, so it also plays correctly when visitors scrub by scrolling. Preview it with the timeline in Advanced mode.</p>
    </div>
  );
}
