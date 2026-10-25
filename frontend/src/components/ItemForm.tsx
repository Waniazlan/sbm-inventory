import React, { useState } from "react";
import { Camera } from "lucide-react";
import { BarcodeScanner } from "./BarcodeScanner";
import { BARCODE_MAX_LENGTH, BARCODE_PATTERN } from "../lib/barcode";

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
  const [barcode, setBarcode] = useState(item?.barcode || "");
  const [scanning, setScanning] = useState(false);
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
      barcode: barcode || null,
      serial_tracking: form.get("serial_tracking") === "on",
      name: text("name"),
      category_id: Number(text("category_id")),
      brand: text("brand"),
      colour: text("colour"),
      grade: text("grade"),
      capacity: text("capacity"),
      unit: text("unit"),
      price: text("price") ? Math.round(Number(text("price")) * 100) : null,
      minimum_stock: Number(text("minimum_stock")),
      active: form.get("active") === "on",
      notes: text("notes"),
      phone_model_ids: phones,
    };
    setBusy(true);
    setError("");
    try {
      const { data: saved } = await api.request<Item>({
        url: "/items" + (item ? "/" + item.id : ""),
        method: item ? "PUT" : "POST",
        data: d,
      });
      notify(
        item
          ? "Item updated."
          : `Item ${saved.sku} created. Receive stock to set its opening quantity.`,
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
    <>
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
            {item && (
              <Field label="SKU">
                <input value={item.sku} readOnly />
              </Field>
            )}
            <div className="barcode-field item-barcode-field wide">
              <Field label="Item barcode or QR value">
                <input
                  name="barcode"
                  value={barcode}
                  onChange={(e) => setBarcode(e.target.value)}
                  required={!!item?.barcode}
                  pattern={BARCODE_PATTERN}
                  maxLength={BARCODE_MAX_LENGTH}
                  inputMode="text"
                  autoCapitalize="off"
                  spellCheck={false}
                  autoComplete="off"
                  placeholder="Leave blank for an automatic store barcode"
                  title="Enter 1–500 characters without line breaks or control characters"
                />
              </Field>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setScanning(true)}
              >
                <Camera size={17} /> Scan barcode
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    const { data } = await api.post<{ barcode: string }>(
                      "/items/generate-barcode",
                    );
                    setBarcode(data.barcode);
                  } catch (e) {
                    setError(errorText(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Generate store barcode
              </Button>
            </div>
            <p className="wide form-help">
              The product barcode is shared by every unit of this item. A blank
              barcode is generated when a new item is saved.
            </p>
            <label className="check wide">
              <input
                name="serial_tracking"
                type="checkbox"
                defaultChecked={item?.serial_tracking ?? false}
                disabled={item?.serial_tracking}
              />
              Track individual serial numbers
            </label>
            {item?.serial_tracking && (
              <input type="hidden" name="serial_tracking" value="on" />
            )}
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
            {(["colour", "capacity", "grade"] as const).map((k) => (
              <Field label={label(k)} key={k}>
                <input name={k} maxLength={80} defaultValue={item?.[k] || ""} />
              </Field>
            ))}
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
      {scanning && (
        <BarcodeScanner
          close={() => setScanning(false)}
          onConfirm={(value) => {
            setBarcode(value);
            setScanning(false);
          }}
        />
      )}
    </>
  );
}
