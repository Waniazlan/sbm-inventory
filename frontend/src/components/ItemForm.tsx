import React, { useState } from "react";

import { api, errorText, label, type Item } from "../api";

import { Button, ErrorBox, Field, Modal } from "../components/shared";
import { useApp } from "../hooks";
export function ItemForm({
  item,
  close,
  done,
}: {
  item?: Item;
  close: () => void;
  done: () => void;
}) {
  const { meta, notify } = useApp();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [phones, setPhones] = useState<number[]>(
    item?.phone_models.map((p) => p.id) || [],
  );
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const text = (k: string) => String(form.get(k) || "");
    const d = {
      sku: text("sku"),
      name: text("name"),
      category_id: Number(text("category_id")),
      supplier_id: text("supplier_id") ? Number(text("supplier_id")) : null,
      brand: text("brand"),
      part_number: text("part_number"),
      colour: text("colour"),
      grade: text("grade"),
      capacity: text("capacity"),
      unit: text("unit"),
      cost: Math.round(Number(text("cost")) * 100),
      price: text("price") ? Math.round(Number(text("price")) * 100) : null,
      minimum_stock: Number(text("minimum_stock")),
      active: form.get("active") === "on",
      notes: text("notes"),
      phone_model_ids: phones,
    };
    setBusy(true);
    setError("");
    try {
      await api.request({
        url: "/items" + (item ? "/" + item.id : ""),
        method: item ? "PUT" : "POST",
        data: d,
      });
      notify(
        item
          ? "Item updated."
          : "Item created. Receive stock to set its opening quantity.",
      );
      done();
      close();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={item ? "Edit inventory item" : "New inventory item"}
      subtitle="Catalogue details and compatible phone models."
      close={() => {
        if (!busy) close();
      }}
    >
      <form onSubmit={submit}>
        <ErrorBox message={error} />
        <fieldset disabled={busy} className="form-grid">
          <Field label="Item name" wide>
            <input
              name="name"
              required
              maxLength={200}
              defaultValue={item?.name}
              placeholder="e.g. iPhone 13 OLED display"
            />
          </Field>
          <Field label="SKU">
            <input
              name="sku"
              required
              maxLength={100}
              defaultValue={item?.sku}
            />
          </Field>
          <Field label="Component category">
            <select
              name="category_id"
              required
              defaultValue={item?.category_id || ""}
            >
              <option value="">Select category</option>
              {meta.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Part brand">
            <input
              name="brand"
              maxLength={100}
              defaultValue={item?.brand || ""}
            />
          </Field>
          <Field label="Supplier">
            <select name="supplier_id" defaultValue={item?.supplier_id || ""}>
              <option value="">No default supplier</option>
              {meta.suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Standard cost (MYR)">
            <input
              name="cost"
              required
              type="number"
              min="0"
              max="1000000"
              step="0.01"
              defaultValue={(item?.cost || 0) / 100}
            />
          </Field>
          <Field label="Selling price (MYR)">
            <input
              name="price"
              type="number"
              min="0"
              max="1000000"
              step="0.01"
              defaultValue={item?.price == null ? "" : item.price / 100}
              placeholder="Optional; needed for POS"
            />
          </Field>
          <Field label="Minimum stock">
            <input
              name="minimum_stock"
              required
              type="number"
              min="0"
              max="100000000"
              defaultValue={item?.minimum_stock || 0}
            />
          </Field>
          <Field label="Unit">
            <select name="unit" defaultValue={item?.unit || "piece"}>
              <option>piece</option>
              <option>set</option>
              <option>pack</option>
            </select>
          </Field>
          {(["part_number", "colour", "capacity", "grade"] as const).map(
            (k) => (
              <Field label={label(k)} key={k}>
                <input name={k} maxLength={80} defaultValue={item?.[k] || ""} />
              </Field>
            ),
          )}
          <div className="field wide">
            <span>Compatible phone models</span>
            <div className="checkbox-list">
              {meta.phone_models.length ? (
                meta.phone_models.map((p) => (
                  <label key={p.id}>
                    <input
                      type="checkbox"
                      checked={phones.includes(p.id)}
                      onChange={(e) =>
                        setPhones(
                          e.target.checked
                            ? [...phones, p.id]
                            : phones.filter((id) => id !== p.id),
                        )
                      }
                    />
                    {p.brand} {p.name}
                  </label>
                ))
              ) : (
                <p>Add phone models in Settings to map compatibility.</p>
              )}
            </div>
          </div>
          <Field label="Notes" wide>
            <textarea
              name="notes"
              maxLength={2000}
              defaultValue={item?.notes || ""}
            />
          </Field>
          <label className="check wide">
            <input
              name="active"
              type="checkbox"
              defaultChecked={item?.active ?? true}
            />
            Active item
          </label>
        </fieldset>
        <div className="modal-footer">
          <Button
            type="button"
            variant="secondary"
            onClick={close}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save item"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
