"use client";

import { useEffect, useLayoutEffect, useState } from "react";

export interface TourStep {
  /** Value of a `data-tour` attribute somewhere on the page. */
  target: string;
  title: string;
  body: string;
  placement?: "right" | "left" | "bottom" | "top";
}

const PAD = 8;

/**
 * Lightweight guided tour: dims the page, rings the target element and shows one card at a time.
 * No library, no portals — positions are measured from the live DOM so it survives layout changes.
 */
export function Tour({ steps, index, onIndex, onClose }: { steps: TourStep[]; index: number; onIndex: (i: number) => void; onClose: (finished: boolean) => void }) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const step = steps[index];

  // Measure the target; skip steps whose target is not on screen (e.g. a panel hidden in Simple mode).
  useLayoutEffect(() => {
    if (!step) return;
    const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
    if (!el) {
      if (index < steps.length - 1) onIndex(index + 1);
      else onClose(true);
      return;
    }
    const measure = () => setRect(el.getBoundingClientRect());
    measure();
    el.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [step, index, steps.length, onIndex, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose(false);
      if (e.key === "ArrowRight" || e.key === "Enter") index < steps.length - 1 ? onIndex(index + 1) : onClose(true);
      if (e.key === "ArrowLeft" && index > 0) onIndex(index - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, steps.length, onIndex, onClose]);

  if (!step || !rect) return null;
  const placement = step.placement ?? "right";
  const card: React.CSSProperties = { position: "fixed", width: 300, zIndex: 101 };
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (placement === "right") Object.assign(card, { left: Math.min(rect.right + 14, vw - 316), top: Math.max(12, Math.min(rect.top, vh - 220)) });
  else if (placement === "left") Object.assign(card, { left: Math.max(12, rect.left - 314), top: Math.max(12, Math.min(rect.top, vh - 220)) });
  else if (placement === "bottom") Object.assign(card, { left: Math.max(12, Math.min(rect.left, vw - 316)), top: Math.min(rect.bottom + 14, vh - 200) });
  else Object.assign(card, { left: Math.max(12, Math.min(rect.left, vw - 316)), top: Math.max(12, rect.top - 190) });

  return (
    <>
      <div className="tour-ring" style={{ left: rect.left - PAD, top: rect.top - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }} onClick={() => onClose(false)} />
      <div className="tour-card stack" style={card} role="dialog" aria-label={step.title}>
        <div className="row between">
          <strong>{step.title}</strong>
          <span className="muted small">
            {index + 1}/{steps.length}
          </span>
        </div>
        <p className="small" style={{ margin: 0 }}>
          {step.body}
        </p>
        <div className="row between">
          <button className="btn sm" onClick={() => onClose(false)}>
            Skip tour
          </button>
          <span className="row" style={{ gap: 6 }}>
            {index > 0 && (
              <button className="btn sm" onClick={() => onIndex(index - 1)}>
                Back
              </button>
            )}
            <button className="btn sm primary" onClick={() => (index < steps.length - 1 ? onIndex(index + 1) : onClose(true))}>
              {index < steps.length - 1 ? "Next" : "Done"}
            </button>
          </span>
        </div>
      </div>
    </>
  );
}

/** Remembers per user whether a tour was completed (browser-local; a tour is a convenience, not state). */
export function tourSeen(key: string): boolean {
  try {
    return localStorage.getItem(key) === "done";
  } catch {
    return true;
  }
}
export function markTourSeen(key: string): void {
  try {
    localStorage.setItem(key, "done");
  } catch {
    /* ignore */
  }
}
