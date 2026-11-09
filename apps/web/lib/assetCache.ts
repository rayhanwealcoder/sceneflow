"use client";

import { useEffect, useState } from "react";
import { api } from "./api";
import type { MediaAsset } from "./types";

const assets = new Map<string, Promise<MediaAsset | null>>();
const waveforms = new Map<string, Promise<number[]>>();

export function loadAsset(id: string): Promise<MediaAsset | null> {
  let p = assets.get(id);
  if (!p) {
    p = api<{ asset: MediaAsset }>(`/api/v1/media/${id}`)
      .then((r) => r.asset)
      .catch(() => null);
    assets.set(id, p);
  }
  return p;
}

export function loadWaveform(url: string): Promise<number[]> {
  let p = waveforms.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => (r.ok ? (r.json() as Promise<{ peaks?: number[] }>) : { peaks: [] }))
      .then((j) => j.peaks ?? [])
      .catch(() => []);
    waveforms.set(url, p);
  }
  return p;
}

/** Peaks for an asset's waveform (empty while loading / when unavailable). */
export function useWaveform(assetId: string | undefined): number[] {
  const [peaks, setPeaks] = useState<number[]>([]);
  useEffect(() => {
    let live = true;
    if (!assetId) return;
    loadAsset(assetId).then((a) => {
      const url = a?.metadataJson.waveformUrl;
      if (!url) return;
      return loadWaveform(url).then((p) => live && setPeaks(p));
    });
    return () => {
      live = false;
    };
  }, [assetId]);
  return peaks;
}
