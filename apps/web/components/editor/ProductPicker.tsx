"use client";

import { useEffect, useState, type FormEvent } from "react";
import { productToRef, type Product, type ProductRef } from "@sceneflow/schema";
import { api, errorMessage } from "@/lib/api";
import type { CatalogProviderInfo } from "@/lib/types";

/**
 * Product picker: one tab per product source of the project (WooCommerce of the connected site,
 * "My products" entered by hand). Picking returns a ProductRef snapshot for the layer/action.
 */
export function ProductPicker({ projectId, workspaceId, onPick, onClose }: { projectId: string; workspaceId: string; onPick: (ref: ProductRef, product: Product) => void; onClose: () => void }) {
  const [providers, setProviders] = useState<CatalogProviderInfo[] | null>(null);
  const [provider, setProvider] = useState<string>("");
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<Product[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    api<{ providers: CatalogProviderInfo[]; default: string }>(`/api/v1/projects/${projectId}/commerce`)
      .then((r) => {
        setProviders(r.providers);
        setProvider(r.default);
      })
      .catch((e) => setError(errorMessage(e)));
  }, [projectId]);

  useEffect(() => {
    if (!provider) return;
    setItems(null);
    setError(null);
    const t = setTimeout(() => {
      api<{ items: Product[] }>(`/api/v1/projects/${projectId}/products?provider=${encodeURIComponent(provider)}&search=${encodeURIComponent(search)}`)
        .then((r) => setItems(r.items))
        .catch((e) => {
          setItems([]);
          setError(errorMessage(e));
        });
    }, 250);
    return () => clearTimeout(t);
  }, [projectId, provider, search]);

  const current = providers?.find((p) => p.id === provider);

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal stack" onClick={(e) => e.stopPropagation()}>
        <div className="row between">
          <h2>Choose a product</h2>
          <button className="btn sm" onClick={onClose}>
            Close
          </button>
        </div>

        {providers && providers.length > 1 && (
          <div className="tabs" role="tablist">
            {providers.map((p) => (
              <button key={p.id} className={provider === p.id ? "on" : ""} onClick={() => setProvider(p.id)} type="button">
                {p.label}
              </button>
            ))}
          </div>
        )}
        {providers && providers.length === 1 && provider === "manual" && (
          <p className="muted small" style={{ margin: 0 }}>
            No shop connected to this project yet, so products are entered by hand (name, price, link). Connect a WooCommerce site in Projects → WordPress sites to pick real products.
          </p>
        )}

        <div className="row">
          <input className="input" style={{ flex: 1, minWidth: 200 }} placeholder={`Search ${current?.label ?? "products"}…`} value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
          {current?.editable && (
            <button className="btn" onClick={() => setAdding((v) => !v)}>
              {adding ? "Cancel" : "+ Add product"}
            </button>
          )}
        </div>

        {adding && current?.editable && (
          <ManualProductForm
            workspaceId={workspaceId}
            onCreated={(p) => {
              setAdding(false);
              setItems((list) => [p, ...(list ?? [])]);
            }}
          />
        )}

        {error && <div className="alert error small">{error}</div>}
        {items === null ? (
          <p className="muted">Loading products…</p>
        ) : items.length === 0 ? (
          <p className="muted">{search ? "No products match." : current?.editable ? "No products yet. Add one above." : "No products found in this store."}</p>
        ) : (
          <div className="media-grid">
            {items.map((p) => (
              <button key={p.id} className="media-tile product-tile" onClick={() => onPick(productToRef(p), p)} title={p.name}>
                {p.image ? <img src={p.image} alt="" /> : <div className="ph" style={{ aspectRatio: "1", display: "grid", placeItems: "center", fontSize: 22 }}>🛍</div>}
                <div className="cap">
                  <strong>{p.name}</strong>
                  <div className="row between" style={{ gap: 6 }}>
                    <span>
                      {p.price ?? ""}
                      {p.regularPrice && p.regularPrice !== p.price ? <s className="muted"> {p.regularPrice}</s> : null}
                    </span>
                    <span className={`badge ${p.stockStatus === "outofstock" ? "bad" : ""}`} style={{ fontSize: 10 }}>
                      {p.type === "variable" ? `${p.variations.length || ""} options` : p.stockStatus === "outofstock" ? "sold out" : "in stock"}
                    </span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ManualProductForm({ workspaceId, onCreated }: { workspaceId: string; onCreated: (p: Product) => void }) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [regular, setRegular] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [url, setUrl] = useState("");
  const [image, setImage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ product: Product }>("/api/v1/products", {
        method: "POST",
        json: { workspaceId, name, priceAmount: Number(price), regularPriceAmount: regular ? Number(regular) : null, currency, productUrl: url || null, imageUrl: image || null, inStock: true },
      });
      onCreated(r.product);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit} style={{ padding: 12, border: "1px solid var(--border)", borderRadius: 10 }}>
      <div className="row">
        <label className="field" style={{ flex: 2, minWidth: 180 }}>
          Product name
          <input className="input sm" value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} />
        </label>
        <label className="field" style={{ width: 110 }}>
          Price
          <input className="input sm" type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} required />
        </label>
        <label className="field" style={{ width: 110 }}>
          Was (optional)
          <input className="input sm" type="number" min={0} step="0.01" value={regular} onChange={(e) => setRegular(e.target.value)} />
        </label>
        <label className="field" style={{ width: 80 }}>
          Currency
          <input className="input sm" value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={3} />
        </label>
      </div>
      <div className="row">
        <label className="field" style={{ flex: 1, minWidth: 200 }}>
          Link (product page, checkout or payment link)
          <input className="input sm" type="url" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} />
        </label>
        <label className="field" style={{ flex: 1, minWidth: 200 }}>
          Image URL (optional)
          <input className="input sm" type="url" placeholder="https://" value={image} onChange={(e) => setImage(e.target.value)} />
        </label>
      </div>
      {error && <div className="alert error small">{error}</div>}
      <div>
        <button className="btn primary sm" disabled={busy} type="submit">
          {busy ? "Saving…" : "Save product"}
        </button>
      </div>
    </form>
  );
}
