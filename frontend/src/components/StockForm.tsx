import React, { useRef, useState } from "react";

import axios from "axios";
import { Check, Package } from "lucide-react";
import { ReceiptForm } from "./ReceiptForm";
import { api, errorText, type Item, type Movement, type Page } from "../api";

import { Button, ErrorBox, Field, Modal } from "../components/shared";
import { useApp, useLoad } from "../hooks";
type StockFormProps = {
  kind: string;
  item?: Item;
  movement?: Movement;
  close: () => void;
  done: () => void;
};
export function StockForm(props: StockFormProps) {
  return props.kind === "receipt" ? (
    <ReceiptForm item={props.item} close={props.close} done={props.done} />
  ) : (
    <SingleStockForm {...props} />
  );
}
function SingleStockForm({
  kind: initial,
  item,
  movement,
  close,
  done,
}: StockFormProps) {
  const { user, notify } = useApp();
  const [kind, setKind] = useState(initial),
    [selected, setSelected] = useState(item?.id.toString() || ""),
    [search, setSearch] = useState(""),
    [reason, setReason] = useState(""),
    [reference, setReference] = useState(""),
    [quantity, setQuantity] = useState("1"),
    [count, setCount] = useState("0"),
    [approval, setApproval] = useState(""),
    [serials, setSerials] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [uncertain, setUncertain] = useState(false);
  const key = useRef(crypto.randomUUID());
  const snapshot = useRef<object | null>(null);
  const products = useLoad<Page<Item>>(
    "/items?search=" + encodeURIComponent(search),
  );
  const titles: Record<string, string> = {
    manual_out: "Issue stock",
    adjustment: "Adjust stock count",
    reversal: "Reverse movement",
  };
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const payload = snapshot.current || {
      request_key: key.current,
      kind,
      item_id: selected ? Number(selected) : undefined,
      quantity: Number(quantity),
      counted_quantity: Number(count),
      movement_id: movement?.id,
      reason,
      reference: reference || null,
      approval_note: approval || null,
      serials: serials || null,
    };
    snapshot.current = payload;
    try {
      await api.post("/movements", payload);
      notify("Stock movement recorded.");
      done();
      close();
    } catch (e) {
      setError(errorText(e));
      if (axios.isAxiosError(e) && e.response && e.response.status < 500) {
        snapshot.current = null;
        key.current = crypto.randomUUID();
        setUncertain(false);
      } else setUncertain(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={titles[kind]}
      subtitle="Every change is recorded in the permanent movement ledger."
      close={() => {
        if (!busy) close();
      }}
    >
      <form onSubmit={submit}>
        <ErrorBox message={error} />
        {uncertain && (
          <p className="notice">
            The result is uncertain. Retry below with the same details, or check
            the ledger before creating another movement.
          </p>
        )}
        <fieldset disabled={busy || uncertain} className="form-grid">
          {initial === "manual_out" && user.role === "admin" && (
            <Field label="Movement type" wide>
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="manual_out">Manual stock-out</option>
                <option value="adjustment">Physical count adjustment</option>
              </select>
            </Field>
          )}
          {kind !== "reversal" &&
            (item ? (
              <div className="selected-item wide">
                <Package size={22} />
                <div>
                  <strong>{item.name}</strong>
                  <small>
                    {item.sku} · {item.stock} {item.unit}(s) on hand
                  </small>
                </div>
              </div>
            ) : (
              <Field label="Find an item" wide>
                <input
                  placeholder="Search by name, SKU or model"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <select
                  required
                  value={selected}
                  onChange={(e) => setSelected(e.target.value)}
                >
                  <option value="">Select an item</option>
                  {products.data?.data.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.sku} · {i.name} ({i.stock} available)
                    </option>
                  ))}
                </select>
                <ErrorBox message={products.error} />
              </Field>
            ))}
          {kind === "reversal" ? (
            <p className="notice wide">
              Reverse #{movement?.id}: {movement?.item.name} ({movement?.delta}
              ). This creates a linked compensating movement.
            </p>
          ) : kind === "adjustment" ? (
            <Field label="Actual quantity counted">
              <input
                type="number"
                min="0"
                max="100000000"
                required
                value={count}
                onChange={(e) => setCount(e.target.value)}
              />
            </Field>
          ) : (
            <Field label="Quantity">
              <input
                type="number"
                min="1"
                max="100000000"
                required
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </Field>
          )}
          <Field
            label={
              kind === "adjustment" ? "Count reference" : "Source reference"
            }
          >
            <input
              required={kind === "adjustment"}
              placeholder="e.g. GRN-1001"
              maxLength={120}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </Field>
          {kind !== "reversal" && (
            <Field label="Unit serial numbers" wide>
              <textarea
                maxLength={130000}
                value={serials}
                onChange={(e) => setSerials(e.target.value)}
                placeholder="For tracked items, enter one serial per issued unit, one per line."
              />
              <small>
                Required for tracked stock leaving the store. For a count
                increase, leave blank to generate new serials. Available serials
                are listed under the item's Labels &amp; serials.
              </small>
            </Field>
          )}
          <Field label="Reason" wide>
            <textarea
              required
              minLength={3}
              maxLength={500}
              placeholder="Explain why this stock movement is needed"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          {kind === "adjustment" && (
            <Field label="Approval note" wide>
              <textarea
                maxLength={1000}
                value={approval}
                onChange={(e) => setApproval(e.target.value)}
              />
            </Field>
          )}
        </fieldset>
        <div className="modal-footer">
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={close}
          >
            Cancel
          </Button>
          <Button disabled={busy} type="submit">
            <Check size={16} />
            {busy
              ? "Recording…"
              : uncertain
                ? "Retry same request"
                : "Record movement"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
