import { useEffect, useRef, useState, type FormEvent } from "react";
import axios from "axios";
import {
  api,
  errorText,
  money,
  type Item,
  type SupplierStockEntry,
} from "../api";
import { Button, ErrorBox, Field } from "./shared";

export function SupplierStockEditor({
  item,
  entry,
  supplierId,
  supplierName,
  done,
  cancel,
  onBusy,
}: {
  item: Item;
  entry: SupplierStockEntry;
  supplierId: number | null;
  supplierName: string;
  done: () => void;
  cancel: () => void;
  onBusy: (busy: boolean) => void;
}) {
  const [brand, setBrand] = useState(entry.brand || "");
  const [quantity, setQuantity] = useState(String(entry.quantity));
  const [reason, setReason] = useState("");
  const [serials, setSerials] = useState("");
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState("");
  const key = useRef(crypto.randomUUID());
  const snapshot = useRef<object | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    formRef.current?.scrollIntoView({ block: "nearest" });
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const payload = snapshot.current || {
      request_key: key.current,
      supplier_id: supplierId,
      original_brand: entry.brand,
      brand: brand.trim() || null,
      edit_token: entry.edit_token,
      counted_quantity: Number(quantity),
      reason,
      serials: serials || null,
    };
    snapshot.current = payload;
    setBusy(true);
    onBusy(true);
    setError("");
    try {
      await api.put(`/items/${item.id}/supplier-stock`, payload);
      done();
    } catch (caught) {
      setError(errorText(caught));
      if (
        axios.isAxiosError(caught) &&
        caught.response &&
        caught.response.status < 500
      ) {
        snapshot.current = null;
        key.current = crypto.randomUUID();
        setUncertain(false);
      } else setUncertain(true);
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }

  const removed = entry.quantity - Number(quantity);
  return (
    <form
      ref={formRef}
      className="supplier-stock-editor"
      onSubmit={submit}
      aria-label="Edit supplier stock"
    >
      <h4>Edit stock · {supplierName}</h4>
      <ErrorBox message={error} />
      {uncertain && (
        <p className="notice">
          The result is uncertain. Retry the same request or cancel and reload
          the product details.
        </p>
      )}
      <fieldset disabled={busy || uncertain}>
        <Field label="Part brand">
          <input
            value={brand}
            onChange={(event) => setBrand(event.target.value)}
            maxLength={100}
          />
        </Field>
        <Field label="On-hand quantity">
          <input
            type="number"
            min={0}
            max={100000000}
            required
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
          />
        </Field>
        {Number(quantity) > entry.quantity && (
          <p className="notice wide">
            Added units use the latest intake cost for this supplier and brand:{" "}
            {money(entry.latest_unit_cost)} per unit.
            {item.serial_tracking ? " New serials will be generated." : ""}
          </p>
        )}
        {item.serial_tracking && removed > 0 && (
          <Field label={`Missing unit serials (${removed})`} wide>
            <textarea
              required
              value={serials}
              onChange={(event) => setSerials(event.target.value)}
              maxLength={130000}
              placeholder="One missing serial per line, from this supplier and brand"
            />
          </Field>
        )}
        <Field label="Reason for change" wide>
          <textarea
            required
            minLength={3}
            maxLength={500}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
      </fieldset>
      <div className="row-actions">
        <Button
          type="button"
          variant="secondary"
          disabled={busy}
          onClick={cancel}
        >
          Cancel edit
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : uncertain ? "Retry same request" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
