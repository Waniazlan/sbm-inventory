import { useEffect, useRef, useState } from "react";
import { ScanBarcode } from "lucide-react";
import { api, errorText, money } from "../api";
import { ErrorBox, Field, Modal, Time } from "./shared";

type Lookup = {
  match: "unit" | "product";
  status: string;
  item: {
    name: string;
    sku: string;
    barcode: string | null;
    brand: string | null;
    price: number | null;
    category: string;
    stock: number;
    available_stock: number;
    active: boolean;
    archived: boolean;
    compatibility: string[];
    colour: string | null;
    capacity: string | null;
    grade: string | null;
  };
  unit: { serial_number: string; received_at: string | null } | null;
  movement: {
    type: string;
    reference: string | null;
    occurred_at: string;
  } | null;
};

export function QuickItemLookup({ close }: { close: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);
  const scanTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const composing = useRef(false);
  const [barcode, setBarcode] = useState("");
  const [result, setResult] = useState<Lookup | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    input.current?.focus();
    return () => {
      request.current?.abort();
      if (scanTimer.current !== null) clearTimeout(scanTimer.current);
    };
  }, []);

  function clearScanTimer() {
    if (scanTimer.current !== null) clearTimeout(scanTimer.current);
    scanTimer.current = null;
  }

  function updateBarcode(value: string) {
    clearScanTimer();
    request.current?.abort();
    setBusy(false);
    setResult(null);
    setError("");
    setBarcode(value);
    if (value.trim() && !composing.current) {
      scanTimer.current = setTimeout(() => void lookup(value), 300);
    }
  }

  async function lookup(code: string) {
    clearScanTimer();
    if (!code.trim() || composing.current) return;
    request.current?.abort();
    const current = new AbortController();
    request.current = current;
    setResult(null);
    setError("");
    setBusy(true);
    setBarcode("");
    input.current?.focus();
    try {
      const { data } = await api.get<Lookup>("/items/lookup", {
        params: { barcode: code },
        signal: current.signal,
      });
      if (!current.signal.aborted) setResult(data);
    } catch (e) {
      if (!current.signal.aborted) setError(errorText(e));
    } finally {
      if (!current.signal.aborted) setBusy(false);
    }
  }

  return (
    <Modal
      title="Quick scan"
      subtitle="Scan to check stock and sale status."
      close={close}
      className="quick-lookup-dialog"
    >
      <form
        className="quick-lookup-form"
        onSubmit={(event) => {
          event.preventDefault();
          void lookup(barcode);
        }}
      >
        <Field label="Barcode or serial number">
          <div className="quick-lookup-input">
            <ScanBarcode size={20} aria-hidden="true" />
            <input
              ref={input}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              maxLength={500}
              placeholder="Scan or type a code…"
              value={barcode}
              onChange={(event) => updateBarcode(event.target.value)}
              onCompositionStart={() => {
                composing.current = true;
                clearScanTimer();
              }}
              onCompositionEnd={(event) => {
                composing.current = false;
                updateBarcode(event.currentTarget.value);
              }}
            />
          </div>
        </Field>
      </form>
      <div className="quick-lookup-result" aria-live="polite" aria-busy={busy}>
        {busy && <p role="status">Checking item…</p>}
        <ErrorBox message={error} />
        {result && (
          <>
            <div className="quick-lookup-summary">
              <div className="quick-lookup-title">
                <h3>{result.item.name}</h3>
                <p>{result.item.sku}</p>
              </div>
              <div className="quick-lookup-badges">
                <span
                  className={`badge ${["In stock", "Returned to stock"].includes(result.status) ? "green" : result.status === "Sold" ? "red" : "amber"}`}
                >
                  {result.status}
                </span>
                {(result.item.archived || !result.item.active) && (
                  <span className="badge neutral">
                    {result.item.archived ? "Archived item" : "Inactive item"}
                  </span>
                )}
              </div>
            </div>
            <dl className="quick-lookup-metrics">
              <div>
                <dt>Selling price</dt>
                <dd>{money(result.item.price)}</dd>
              </div>
              <div>
                <dt>Available stock</dt>
                <dd>{result.item.available_stock}</dd>
              </div>
            </dl>
            <dl className="quick-lookup-identifier">
              <div>
                <dt>{result.unit ? "Serial number" : "Barcode"}</dt>
                <dd>
                  <code>
                    {result.unit?.serial_number ?? result.item.barcode ?? "—"}
                  </code>
                </dd>
              </div>
            </dl>
            <section className="quick-lookup-section" aria-label="Item details">
              <h4>Item details</h4>
              <dl className="quick-lookup-details">
                {Object.entries({
                  Brand: result.item.brand,
                  Category: result.item.category,
                  Colour: result.item.colour,
                  Capacity: result.item.capacity,
                  Grade: result.item.grade,
                  Compatibility: result.item.compatibility.join(", "),
                })
                  .filter(([, value]) => value !== null && value !== "")
                  .map(([caption, value]) => (
                    <div
                      key={caption}
                      className={
                        caption === "Compatibility"
                          ? "quick-lookup-wide"
                          : undefined
                      }
                    >
                      <dt>{caption}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
              </dl>
            </section>
            {(result.unit?.received_at || result.movement) && (
              <section
                className="quick-lookup-section"
                aria-label="Item activity"
              >
                <h4>Activity</h4>
                <dl className="quick-lookup-details">
                  {result.movement?.reference && (
                    <div className="quick-lookup-wide">
                      <dt>Reference</dt>
                      <dd>{result.movement.reference}</dd>
                    </div>
                  )}
                  {result.unit?.received_at && (
                    <div>
                      <dt>Received</dt>
                      <dd>
                        <Time value={result.unit.received_at} />
                      </dd>
                    </div>
                  )}
                  {result.movement && (
                    <div>
                      <dt>
                        {result.status === "Sold" ? "Sold on" : "Last movement"}
                      </dt>
                      <dd>
                        <Time value={result.movement.occurred_at} />
                      </dd>
                    </div>
                  )}
                </dl>
              </section>
            )}
            {result.match === "product" && (
              <p className="quick-lookup-note">
                Shared product barcode. Scan an individual unit’s serial label
                to check whether that exact unit was sold.
              </p>
            )}
          </>
        )}
        {!result && !busy && !error && (
          <div className="quick-lookup-empty">
            <ScanBarcode size={28} aria-hidden="true" />
            <p>Ready to scan.</p>
          </div>
        )}
      </div>
    </Modal>
  );
}
