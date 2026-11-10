"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Funnel, LineChart, TimelineChart } from "@/components/analytics/charts";
import { api, API_URL, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { AnalyticsSummary, Project } from "@/lib/types";

const RANGES = [7, 30, 90, 365] as const;
const money = (amount: number, currency: string) => {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
};
const fmtSec = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${s.toFixed(s < 10 ? 1 : 0)}s`);

/** Doc §24: basic dashboard + engagement timeline. Everything comes from one summary request. */
export default function AnalyticsPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useSession();
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [days, setDays] = useState<(typeof RANGES)[number]>(7);
  const [data, setData] = useState<AnalyticsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user === null) router.replace("/login");
  }, [user, router]);

  useEffect(() => {
    if (!user) return;
    api<{ project: Project }>(`/api/v1/projects/${id}`)
      .then((r) => setProject(r.project))
      .catch((e) => setError(errorMessage(e)));
  }, [user, id]);

  useEffect(() => {
    if (!user) return;
    setData(null);
    api<AnalyticsSummary>(`/api/v1/projects/${id}/analytics?days=${days}`)
      .then(setData)
      .catch((e) => setError(errorMessage(e)));
  }, [user, id, days]);

  if (!user || !project) return <p className="muted">Loading…</p>;
  const t = data?.totals;
  const fillDays = (): string[] => {
    const out: string[] = [];
    const end = new Date();
    for (let i = days - 1; i >= 0; i--) out.push(new Date(end.getTime() - i * 86_400_000).toISOString().slice(0, 10));
    return out;
  };
  const labels = fillDays();
  const byDay = new Map(data?.daily.map((d) => [d.day, d]) ?? []);
  const notPublished = project.status !== "published";

  return (
    <div className="stack">
      <div className="row between">
        <div>
          <Link href={`/projects/${project.id}`} className="small">
            ← {project.name}
          </Link>
          <h1>Analytics</h1>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <div className="tabs" role="tablist" aria-label="Range">
            {RANGES.map((r) => (
              <button key={r} className={days === r ? "on" : ""} onClick={() => setDays(r)} type="button">
                {r === 365 ? "Last year" : `Last ${r} days`}
              </button>
            ))}
          </div>
          <a className="btn sm" href={`${API_URL}/api/v1/projects/${project.id}/analytics.csv?days=${days}&view=daily`} data-testid="analytics-csv" title="One row per day: loads, plays, clicks, carts, orders, revenue">
            Download CSV
          </a>
          <a className="btn sm" href={`${API_URL}/api/v1/projects/${project.id}/analytics.csv?days=${days}&view=events`} data-testid="analytics-csv-events" title="Every anonymous event in this range (up to 100 000)">
            Raw events
          </a>
        </div>
      </div>
      {error && <div className="alert error">{error}</div>}
      {notPublished && <div className="alert">This video is not published yet. Events arrive once it plays on a page.</div>}
      {data && t && t.loads === 0 && !notPublished && (
        <div className="alert">
          No visits in this range yet. Open the page where the video is embedded — events show up here within a few seconds. Visitors with “Do Not Track” are never counted.
        </div>
      )}

      {!data ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <div className="stat-grid">
            <Stat label="Player loads" value={t!.loads} hint={`${t!.sessions} visitors`} />
            <Stat label="Plays" value={t!.plays} hint={t!.playRate !== null ? `${t!.playRate}% of loads` : "–"} />
            <Stat label="Completed" value={t!.completes} hint={t!.completionRate !== null ? `${t!.completionRate}% of plays` : "–"} />
            <Stat label="Avg. watch time" value={fmtSec(t!.avgWatchSeconds)} hint={data.timeline.duration ? `video is ${fmtSec(data.timeline.duration)}` : ""} />
            <Stat label="Clicks" value={t!.clicks} hint="buttons + hotspots" />
            <Stat label="Add to cart" value={t!.addToCarts} hint={`${t!.checkouts} checkout${t!.checkouts === 1 ? "" : "s"} · ${t!.productViews} product views`} />
            {(t!.orders ?? 0) > 0 && (
              <>
                <Stat label="Orders" value={t!.orders!} hint={t!.conversionRate != null ? `${t!.conversionRate} per 100 plays` : "paid orders"} testId="stat-orders" />
                <Stat label="Revenue" value={(t!.revenue ?? []).map((r) => money(r.revenue, r.currency)).join(" + ")} hint="from products added in this video" testId="stat-revenue" />
              </>
            )}
          </div>

          <section className="card stack">
            <h2>Loads and plays per day</h2>
            <LineChart
              labels={labels}
              series={[
                { key: "loads", label: "Player loads", slot: 1, values: labels.map((d) => byDay.get(d)?.loads ?? 0) },
                { key: "plays", label: "Plays", slot: 2, values: labels.map((d) => byDay.get(d)?.plays ?? 0) },
              ]}
              empty="No loads in this range."
            />
          </section>

          <div className="two-col">
            <section className="card stack">
              <h2>Engagement timeline</h2>
              <p className="muted small" style={{ margin: 0 }}>
                How many visitors were watching each part of the video. Drops show where people leave; scene names run along the bottom.
              </p>
              <TimelineChart values={data.timeline.values} duration={data.timeline.duration} scenes={data.scenes} empty="Appears after the first plays." />
            </section>
            <section className="card stack">
              <h2>Funnel</h2>
              <Funnel
                steps={[
                  { label: "Loaded", value: t!.loads },
                  { label: "Played", value: t!.plays },
                  { label: "25%", value: t!.quartiles.q25 },
                  { label: "50%", value: t!.quartiles.q50 },
                  { label: "75%", value: t!.quartiles.q75 },
                  { label: "Finished", value: t!.quartiles.complete },
                ]}
              />
              <h3 className="small muted" style={{ margin: "8px 0 0" }}>
                DEVICES
              </h3>
              <Funnel
                steps={[
                  { label: "Desktop", value: data.devices.desktop },
                  { label: "Tablet", value: data.devices.tablet },
                  { label: "Mobile", value: data.devices.mobile },
                ]}
              />
            </section>
          </div>

          <div className="two-col">
            <section className="card stack">
              <h2>Elements</h2>
              {data.elements.length === 0 ? (
                <p className="muted small">Clicks on buttons, hotspots and product cards show up here.</p>
              ) : (
                <table className="data-table small">
                  <thead>
                    <tr>
                      <th>Element</th>
                      <th>Seen</th>
                      <th>Clicks</th>
                      <th>CTR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.elements.map((e) => (
                      <tr key={e.layerId}>
                        <td>
                          {e.name} <span className="muted">· {e.type}</span>
                        </td>
                        <td>{e.impressions}</td>
                        <td>{e.clicks}</td>
                        <td>{e.ctr === null ? "–" : `${e.ctr}%`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
            <section className="card stack">
              <h2>Scenes</h2>
              <table className="data-table small">
                <thead>
                  <tr>
                    <th>Scene</th>
                    <th>Time</th>
                    <th>Reached by</th>
                  </tr>
                </thead>
                <tbody>
                  {data.scenes.map((s) => (
                    <tr key={s.sceneId}>
                      <td>{s.name}</td>
                      <td className="muted">
                        {s.start.toFixed(1)}–{s.end.toFixed(1)}s
                      </td>
                      <td>
                        {s.sessions} <span className="muted">visitor{s.sessions === 1 ? "" : "s"}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>

          <div className="two-col">
            <section className="card stack">
              <h2>Products</h2>
              {data.products.length === 0 ? (
                <p className="muted small">Product views, add-to-carts and checkouts started from this video, and paid orders when your shop runs SceneFlow 0.8.0 or newer with analytics on.</p>
              ) : (
                <table className="data-table small">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Views</th>
                      <th>Add to cart</th>
                      <th>Checkout</th>
                      <th>Orders</th>
                      <th>Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.products.map((p) => (
                      <tr key={p.productId}>
                        <td>{p.title}</td>
                        <td>{p.views}</td>
                        <td>{p.addToCarts}</td>
                        <td>{p.checkouts}</td>
                        <td>{p.orders ?? 0}</td>
                        <td>{p.revenue && t!.revenue?.length === 1 ? money(p.revenue, t!.revenue[0]!.currency) : (p.revenue ?? 0) || "–"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
            <section className="card stack">
              <h2>Pages</h2>
              {data.pages.length === 0 ? (
                <p className="muted small">Where the video was loaded.</p>
              ) : (
                <table className="data-table small">
                  <thead>
                    <tr>
                      <th>Page</th>
                      <th>Loads</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.pages.map((p) => (
                      <tr key={p.host + p.path}>
                        <td>
                          {p.host}
                          <span className="muted">{p.path}</span>
                        </td>
                        <td>{p.loads}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </div>
          <p className="muted small">
            Anonymous: no cookies, no IP addresses stored; a random per-tab id groups a visit. Orders are counted without any customer data. Visitors with Do Not Track or Global Privacy Control are not counted. {t!.errors > 0 ? `${t!.errors} player error${t!.errors === 1 ? "" : "s"} in this range.` : ""}
          </p>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, hint, testId }: { label: string; value: number | string; hint?: string; testId?: string }) {
  return (
    <div className="stat" data-testid={testId}>
      <span className="small muted">{label}</span>
      <strong className="stat-value">{value}</strong>
      {hint ? <span className="small muted">{hint}</span> : null}
    </div>
  );
}
