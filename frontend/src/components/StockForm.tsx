import React, { useRef, useState } from "react";

import axios from "axios";
import { Check, Package } from "lucide-react";
import {
  api,
  errorText,
  type Item,
  type Job,
  type Movement,
  type Page,
} from "../api";

import { Button, ErrorBox, Field, Modal } from "../components/shared";
import { useApp, useLoad } from "../hooks";
export function StockForm({
  kind: initial,
  item,
  movement,
  close,
  done,
}: {
  kind: string;
  item?: Item;
  movement?: Movement;
  close: () => void;
  done: () => void;
}) {
  const { user, meta, notify } = useApp();
  const [kind, setKind] = useState(initial),
    [selected, setSelected] = useState(item?.id.toString() || ""),
    [search, setSearch] = useState(""),
    [reason, setReason] = useState(""),
    [reference, setReference] = useState(""),
    [quantity, setQuantity] = useState("1"),
    [count, setCount] = useState("0"),
    [supplier, setSupplier] = useState(""),
    [cost, setCost] = useState(""),
    [batch, setBatch] = useState(""),
    [serials, setSerials] = useState(""),
    [approval, setApproval] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [uncertain, setUncertain] = useState(false);
  const key = useRef(crypto.randomUUID());
  const snapshot = useRef<object | null>(null);
  const products = useLoad<Page<Item>>(
    "/items?search=" + encodeURIComponent(search),
  );
  const [jobSearch, setJobSearch] = useState("");
  const jobs = useLoad<Page<Job>>(
    "/repair-jobs?search=" + encodeURIComponent(jobSearch),
  );
  const titles: Record<string, string> = {
    receipt: "Receive stock",
    manual_out: "Issue stock",
    adjustment: "Adjust stock count",
    repair_usage: "Record repair usage",
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
      supplier_id: supplier ? Number(supplier) : null,
      unit_cost: cost ? Math.round(Number(cost) * 100) : null,
      batch: batch || null,
      serials: serials || null,
      approval_note: approval || null,
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
                <option value="repair_usage">Repair usage</option>
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
          {kind === "repair_usage" ? (
            <Field label="Assigned repair job">
              <input
                aria-label="Search repair references"
                placeholder="Search repair reference"
                value={jobSearch}
                onChange={(e) => setJobSearch(e.target.value)}
              />
              <select
                required
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              >
                <option value="">Select active repair</option>
                {jobs.data?.data
                  .filter((j) => j.active)
                  .map((j) => (
                    <option key={j.id}>{j.reference}</option>
                  ))}
              </select>
              <small>Only active assigned jobs can consume parts.</small>
            </Field>
          ) : (
            <Field
              label={
                kind === "adjustment" ? "Count reference" : "Source reference"
              }
            >
              <input
                required={
                  kind === "adjustment" || (kind === "receipt" && !supplier)
                }
                placeholder="e.g. GRN-1001"
                maxLength={120}
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            </Field>
          )}
          {kind === "receipt" && (
            <>
              <Field label="Supplier">
                <select
                  value={supplier}
                  onChange={(e) => setSupplier(e.target.value)}
                >
                  <option value="">Use reference instead</option>
                  {meta.suppliers.map((s) => (
                    <option value={s.id} key={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Receipt unit cost (MYR)">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={cost}
                  onChange={(e) => setCost(e.target.value)}
                  placeholder="Optional"
                />
              </Field>
              <Field label="Batch reference">
                <input
                  value={batch}
                  onChange={(e) => setBatch(e.target.value)}
                  maxLength={150}
                />
              </Field>
              <Field label="Serial details">
                <input
                  value={serials}
                  onChange={(e) => setSerials(e.target.value)}
                  maxLength={2000}
                />
              </Field>
            </>
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
