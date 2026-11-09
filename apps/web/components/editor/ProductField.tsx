"use client";

import { useEffect, useState } from "react";
import type { Product, ProductRef } from "@sceneflow/schema";
import { api } from "@/lib/api";
import { Field } from "./fields";
import { ProductPicker } from "./ProductPicker";

/** Shows the picked product with a change button and, for products with options, a variant select. */
export function ProductField({ projectId, workspaceId, value, onChange, allowVariant = true }: { projectId: string; workspaceId: string; value: ProductRef | undefined; onChange: (ref: ProductRef | undefined, product?: Product) => void; allowVariant?: boolean }) {
  const [open, setOpen] = useState(false);
  const [live, setLive] = useState<Product | null>(null);

  // Load variants for the chosen product so the user can pin one.
  useEffect(() => {
    setLive(null);
    if (!value || !allowVariant) return;
    let alive = true;
    api<{ product: Product }>(`/api/v1/projects/${projectId}/products/${encodeURIComponent(value.productId)}?provider=${encodeURIComponent(value.provider)}`)
      .then((r) => alive && setLive(r.product))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [projectId, value?.productId, value?.provider, allowVariant]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <Field label="Product">
        {value ? (
          <div className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
            {value.image ? <img src={value.image} alt="" style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 6, flex: "none" }} /> : null}
            <span className="small" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              <strong>{value.title || value.productId}</strong>
              {value.price ? <span className="muted"> · {value.price}</span> : null}
            </span>
            <button className="btn sm" onClick={() => setOpen(true)} type="button">
              Change
            </button>
          </div>
        ) : (
          <button className="btn sm primary" onClick={() => setOpen(true)} type="button">
            Choose a product
          </button>
        )}
      </Field>
      {value && live && live.variations.length > 0 && (
        <Field label="Option" hint="leave on “Let the visitor choose” for a selector in the player">
          <select
            className="input sm"
            value={value.variantId ?? ""}
            onChange={(e) => {
              const id = e.target.value;
              const v = live.variations.find((x) => x.id === id);
              const { variantId: _old, ...rest } = value;
              onChange(v ? { ...rest, variantId: v.id, price: v.price ?? rest.price, inStock: v.inStock ?? rest.inStock } : rest, live);
            }}
          >
            <option value="">Let the visitor choose</option>
            {live.variations.map((v) => (
              <option key={v.id} value={v.id}>
                {v.title}
                {v.price ? ` — ${v.price}` : ""}
                {v.inStock === false ? " (sold out)" : ""}
              </option>
            ))}
          </select>
        </Field>
      )}
      {open && (
        <ProductPicker
          projectId={projectId}
          workspaceId={workspaceId}
          onPick={(ref, product) => {
            setOpen(false);
            onChange(ref, product);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
