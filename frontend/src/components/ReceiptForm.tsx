import { useEffect, useRef, useState, type FormEvent } from "react";
import axios from "axios";
import { Camera, Check, Minus, Plus } from "lucide-react";
import { api, errorText, type Item } from "../api";
import { useApp, useLoad } from "../hooks";
import { BarcodeScanner } from "./BarcodeScanner";
import { Button, ErrorBox, Field, Modal } from "./shared";

type ReceiptItem = Pick<Item, "id" | "sku" | "name" | "stock" | "unit">;
type ReceiptLine = {
  key: string;
  itemId: string;
  quantity: string;
  cost: string;
  batch: string;
  serials: string;
};
const newLine = (itemId = ""): ReceiptLine => ({
  key: crypto.randomUUID(),
  itemId,
  quantity: "1",
  cost: "",
  batch: "",
  serials: "",
});

export function ReceiptForm({
  item,
  close,
  done,
}: {
  item?: Item;
  close: () => void;
  done: () => void;
}) {
  const { meta, notify } = useApp();
  const products = useLoad<ReceiptItem[]>("/items/options");
  const [lines, setLines] = useState<ReceiptLine[]>(() => [
    newLine(item?.id.toString()),
  ]);
  const [supplier, setSupplier] = useState("");
  const [reference, setReference] = useState("");
  const [scanningLine, setScanningLine] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const key = useRef(crypto.randomUUID());
  const snapshot = useRef<object | null>(null);
  const errorBox = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error) errorBox.current?.scrollIntoView({ block: "nearest" });
  }, [error]);

  function updateLine(rowKey: string, patch: Partial<ReceiptLine>) {
    setLines((current) =>
      current.map((line) =>
        line.key === rowKey ? { ...line, ...patch } : line,
      ),
    );
  }
  function addSerial(value: string) {
    const line = lines.find((row) => row.key === scanningLine);
    setScanningLine(null);
    if (!line) return;
    if (lines.some((row) => row.serials.split(/\r?\n/).includes(value))) {
      setError("This serial number is already listed in this receipt.");
      return;
    }
    const serials =
      line.serials +
      (line.serials && !line.serials.endsWith("\n") ? "\n" : "") +
      value;
    if (serials.length > 2000) {
      setError(
        "Serial details can contain up to 2,000 characters per item. The scanned serial was not added.",
      );
      return;
    }
    updateLine(line.key, { serials });
    setError("");
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const payload = snapshot.current || {
      request_key: key.current,
      kind: "receipt",
      supplier_id: supplier ? Number(supplier) : null,
      reference: reference || null,
      items: lines.map((line) => ({
        item_id: Number(line.itemId),
        quantity: Number(line.quantity),
        unit_cost: line.cost ? Math.round(Number(line.cost) * 100) : null,
        batch: line.batch || null,
        serials: line.serials || null,
      })),
    };
    snapshot.current = payload;
    setBusy(true);
    setError("");
    try {
      await api.post("/movements", payload);
      notify("Stock receipt recorded.");
      done();
      close();
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
    }
  }
  return (
    <>
      <Modal
        className="receipt-dialog receipt-multi-dialog"
        title="Receive stock"
        close={() => {
          if (!busy) close();
        }}
      >
        <form onSubmit={submit}>
          <div className="receipt-form-body">
            <div ref={errorBox} className="receipt-errors">
              <ErrorBox message={error} />
            </div>
            {uncertain && (
              <p className="notice">
                The result is uncertain. Retry with the same details, or check
                the ledger before creating another receipt.
              </p>
            )}
            <fieldset
              disabled={busy || uncertain}
              className="receipt-multi-fields"
            >
              <section
                className="receipt-section receipt-shared-fields"
                aria-label="Delivery details"
              >
                <h3>Delivery details</h3>
                <Field label="Supplier">
                  <select
                    value={supplier}
                    onChange={(event) => setSupplier(event.target.value)}
                  >
                    <option value="">Select supplier</option>
                    {meta.suppliers.map((supplier) => (
                      <option key={supplier.id} value={supplier.id}>
                        {supplier.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Source reference">
                  <input
                    required={!supplier}
                    value={reference}
                    onChange={(event) => setReference(event.target.value)}
                    maxLength={120}
                    placeholder="Invoice or delivery order"
                  />
                </Field>
              </section>
              <div className="receipt-items-heading">
                <h3>Items</h3>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={lines.length >= 100}
                  onClick={() => setLines((current) => [...current, newLine()])}
                >
                  <Plus size={16} /> Add item
                </Button>
              </div>
              <ErrorBox message={products.error} />
              {products.error && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={products.reload}
                >
                  Retry item list
                </Button>
              )}
              <div className="receipt-lines">
                {lines.map((line, index) => (
                  <section
                    className="receipt-line"
                    role="group"
                    aria-label={`Item ${index + 1}`}
                    key={line.key}
                  >
                    <div className="receipt-line-heading">
                      <h4>Item {index + 1}</h4>
                      <Button
                        type="button"
                        variant="quiet"
                        aria-label={`Remove item ${index + 1}`}
                        disabled={lines.length === 1}
                        onClick={() =>
                          setLines((current) =>
                            current.filter((row) => row.key !== line.key),
                          )
                        }
                      >
                        <Minus size={17} />
                      </Button>
                    </div>
                    <div className="receipt-line-main">
                      <Field label="Item">
                        <select
                          required
                          autoFocus={index > 0}
                          value={line.itemId}
                          onChange={(event) =>
                            updateLine(line.key, { itemId: event.target.value })
                          }
                          disabled={products.loading}
                        >
                          <option value="">
                            {products.loading
                              ? "Loading items…"
                              : "Select item"}
                          </option>
                          {products.data?.map((product) => (
                            <option key={product.id} value={product.id}>
                              {product.sku} · {product.name}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Quantity">
                        <input
                          type="number"
                          required
                          min="1"
                          max="100000000"
                          value={line.quantity}
                          onChange={(event) =>
                            updateLine(line.key, {
                              quantity: event.target.value,
                            })
                          }
                        />
                      </Field>
                      <Field label="Receipt unit cost (MYR)">
                        <input
                          type="number"
                          min="0"
                          max="1000000"
                          step="0.01"
                          placeholder="Optional"
                          value={line.cost}
                          onChange={(event) =>
                            updateLine(line.key, { cost: event.target.value })
                          }
                        />
                      </Field>
                    </div>
                    <div className="receipt-line-details">
                      <Field label="Batch reference">
                        <input
                          maxLength={150}
                          value={line.batch}
                          onChange={(event) =>
                            updateLine(line.key, { batch: event.target.value })
                          }
                        />
                      </Field>
                      <div className="barcode-field receipt-line-serials">
                        <Field label="Serial details">
                          <textarea
                            rows={1}
                            maxLength={2000}
                            autoCapitalize="off"
                            spellCheck={false}
                            value={line.serials}
                            onChange={(event) =>
                              updateLine(line.key, {
                                serials: event.target.value,
                              })
                            }
                          />
                        </Field>
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => setScanningLine(line.key)}
                        >
                          <Camera size={16} /> Scan serial
                        </Button>
                      </div>
                    </div>
                  </section>
                ))}
              </div>
            </fieldset>
          </div>
          <div className="modal-footer">
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={close}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={busy || products.loading || !!products.error}
            >
              <Check size={16} />
              {busy
                ? "Receiving…"
                : uncertain
                  ? "Retry same request"
                  : "Receive stock"}
            </Button>
          </div>
        </form>
      </Modal>
      {scanningLine && (
        <BarcodeScanner
          mode="serial"
          close={() => setScanningLine(null)}
          onConfirm={addSerial}
        />
      )}
    </>
  );
}
