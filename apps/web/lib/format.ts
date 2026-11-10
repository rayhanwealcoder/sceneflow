/** 1536 → "1.5 KB"; 0 → "0 B". */
export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

/** 4.2 → "0:04"; 65 → "1:05". */
export function fmtTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** "just now", "5 min ago", "3 h ago", "2 days ago", then a date. */
export function timeAgo(iso: string | Date, now = Date.now()): string {
  const t = typeof iso === "string" ? new Date(iso).getTime() : iso.getTime();
  const diff = Math.max(0, now - t);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  if (d < 14) return `${d} day${d === 1 ? "" : "s"} ago`;
  return new Date(t).toLocaleDateString();
}

/** Renders `@Name` mentions in a comment as highlighted spans (plain text otherwise). Full names and first names, like the server. */
export function splitMentions(body: string, names: string[]): Array<{ text: string; mention: boolean }> {
  if (!names.length) return [{ text: body, mention: false }];
  const sorted = [...new Set(names.flatMap((n) => [n.trim(), n.trim().split(/\s+/)[0] ?? ""]))].filter(Boolean).sort((a, b) => b.length - a.length);
  const re = new RegExp(`@(${sorted.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?![A-Za-z0-9])`, "gi");
  const out: Array<{ text: string; mention: boolean }> = [];
  let last = 0;
  for (const m of body.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ text: body.slice(last, i), mention: false });
    out.push({ text: m[0], mention: true });
    last = i + m[0].length;
  }
  if (last < body.length) out.push({ text: body.slice(last), mention: false });
  return out;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
