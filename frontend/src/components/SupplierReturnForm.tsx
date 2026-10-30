import { useRef, useState, type FormEvent } from "react";
import axios from "axios";
import { Camera, Check } from "lucide-react";
import {
  api,
  errorText,
  label,
  type Item,
  type ItemDetail,
  type SupplierReturn,
  type SupplierReturnStatus,
} from "../api";
import { useApp, useLoad } from "../hooks";
import { Button, ErrorBox, Field, Modal } from "./shared";
import { returnNumber, returnStatuses } from "../lib/supplier-returns";
import { BarcodeScanner } from "./BarcodeScanner";
import { BARCODE_MAX_LENGTH, validBarcode } from "../lib/barcode";

type ReturnItem = Pick<
  Item,
  | "id"
  | "sku"
  | "name"
  | "stock"
  | "available_stock"
  | "unit"
  | "serial_tracking"
>;

export function SupplierReturnForm({
  entry,
  close,
  done,
}: {
  entry?: SupplierReturn;
  close: () => void;
  done: () => void;
}) {
  const { meta, notify } = useApp();
  const [selected, setSelected] = useState<ReturnItem | null>(null);
  const itemId = selected ? String(selected.id) : "";
  const [barcode, setBarcode] = useState("");
  const [scanning, setScanning] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [scanError, setScanError] = useState("");
  const lookupLock = useRef(false);
  const scanInput = useRef<HTMLInputElement>(null);
  const [supplierId, setSupplierId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [status, setStatus] = useState<SupplierReturnStatus>(
    entry?.status || "process",
  );
  const [reason, setReason] = useState("");
  const [serials, setSerials] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const key = useRef(crypto.randomUUID());
  const snapshot = useRef<object | null>(null);
  async function lookupBarcode(value: string) {
    if (lookupLock.current || busy || uncertain) return;
    if (!validBarcode(value)) {
      setScanError("Scan or enter a valid item barcode or unit serial number.");
      return;
    }
    lookupLock.current = true;
    setResolving(true);
    setScanError("");
    try {
      const { data } = await api.get<{
        item: ReturnItem;
        serial_number: string | null;
        supplier_id: number | null;
      }>("/supplier-returns/lookup", { params: { barcode: value } });
      if (selected && selected.id !== data.item.id)
        throw new Error(
          "This code belongs to a different item. Clear the selected item to start another return.",
        );
      if (data.serial_number) {
        const current = serials ? serials.split("\n") : [];
        if (current.includes(data.serial_number))
          throw new Error("This serial number has already been added.");
        if (selected && Number(supplierId) !== data.supplier_id)
          throw new Error(
            "This serial belongs to a different supplier. Add it in a separate supplier return.",
          );
        if (current.length >= 1000)
          throw new Error("Return at most 1,000 serialized units at a time.");
        const next = [...current, data.serial_number];
        setSerials(next.join("\n"));
        setQuantity(String(next.length));
        setSupplierId(String(data.supplier_id));
      } else if (!selected) {
        setQuantity("1");
        setSupplierId(data.supplier_id ? String(data.supplier_id) : "");
      }
      setSelected(data.item);
      setBarcode("");
    } catch (caught) {
      setScanError(errorText(caught));
    } finally {
      lookupLock.current = false;
      setResolving(false);
      setTimeout(() => scanInput.current?.focus(), 0);
    }
  }

  function clearItem() {
    setSelected(null);
    setSupplierId("");
    setQuantity("1");
    setSerials("");
    setBarcode("");
    setScanError("");
    scanInput.current?.focus();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || resolving) return;
    if (!entry && !selected) {
      setError(
        "Scan an item barcode or individual unit serial before adding the return.",
      );
      return;
    }
    const payload =
      snapshot.current ||
      (entry
        ? {
            status,
            expected_status: entry.status,
          }
        : {
            request_key: key.current,
            item_id: Number(itemId),
            supplier_id: Number(supplierId),
            quantity: Number(quantity),
            status,
            reason,
            serials: serials || null,
          });
    snapshot.current = payload;
    setBusy(true);
    setError("");
    try {
      if (entry) await api.put(`/supplier-returns/${entry.id}`, payload);
      else await api.post("/supplier-returns", payload);
      notify(
        entry ? "Supplier return status updated." : "Supplier return added.",
      );
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

  const effect = entry
    ? status === entry.status
      ? "The stock balance will stay the same."
      : status === "process"
        ? "The quantity will return to on-hand stock and stay frozen. It cannot be used while in Process."
        : entry.status === "process"
          ? "The frozen quantity will be deducted from on-hand stock."
          : "Stock is already deducted. Changing between Delivered and Rejected will not deduct it again."
    : status === "process"
      ? "The quantity stays in on-hand stock and is frozen from use until Delivered or Rejected."
      : "The quantity will be deducted from stock immediately.";

  return (
    <>
      <Modal
        title={
          entry ? `Update ${returnNumber(entry.id)}` : "Add supplier return"
        }
        subtitle={
          entry
            ? "Update the return status and its stock balance."
            : "Scan an item barcode or unit serial to select the return item."
        }
        close={() => {
          if (!busy && !resolving) close();
        }}
      >
        <form onSubmit={submit}>
          <ErrorBox message={error} />
          {uncertain && (
            <p className="notice">
              The result is uncertain. Retry with the same details, or close and
              check the table before adding another return.
            </p>
          )}
          <fieldset
            className="form-grid"
            disabled={busy || uncertain || resolving}
          >
            {entry ? (
              <div className="selected-item wide">
                <div>
                  <strong>{entry.item.name}</strong>
                  <small>
                    {entry.item.sku} · {entry.supplier.name} · {entry.quantity}{" "}
                    {entry.item.unit}(s)
                  </small>
                  <small>{entry.reason}</small>
                  {entry.serials && (
                    <small className="return-serials">{entry.serials}</small>
                  )}
                </div>
              </div>
            ) : (
              <>
                <div className="wide return-item-scan">
                  <Field label="Item barcode / unit serial">
                    <input
                      ref={scanInput}
                      autoFocus
                      autoComplete="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      maxLength={BARCODE_MAX_LENGTH}
                      placeholder="Scan a label or enter its code"
                      value={barcode}
                      onChange={(event) => setBarcode(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void lookupBarcode(event.currentTarget.value);
                        }
                      }}
                    />
                  </Field>
                  <div className="actions">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setScanning(true)}
                    >
                      <Camera size={16} /> Scan barcode / serial
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={!validBarcode(barcode)}
                      onClick={() => void lookupBarcode(barcode)}
                    >
                      Find item
                    </Button>
                  </div>
                  <small>
                    {resolving
                      ? "Finding item…"
                      : "Use a scanner, camera or photo. For tracked items, scan each individual unit serial."}
                  </small>
                  <ErrorBox message={scanError} />
                </div>
                {selected && (
                  <div className="selected-item wide return-selected-item">
                    <div>
                      <strong>{selected.name}</strong>
                      <small>
                        {selected.sku} ·{" "}
                        {selected.available_stock ?? selected.stock}{" "}
                        {selected.unit}(s) available
                      </small>
                    </div>
                    <Button type="button" variant="quiet" onClick={clearItem}>
                      Clear item
                    </Button>
                  </div>
                )}
                <Field label="Supplier">
                  <select
                    required
                    disabled={!!selected?.serial_tracking}
                    value={supplierId}
                    onChange={(event) => setSupplierId(event.target.value)}
                  >
                    <option value="">Select supplier</option>
                    {meta.suppliers.map((supplier) => (
                      <option key={supplier.id} value={supplier.id}>
                        {supplier.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Quantity">
                  <input
                    required
                    type="number"
                    min="1"
                    max={selected?.serial_tracking ? 1000 : 100000000}
                    readOnly={!!selected?.serial_tracking}
                    value={quantity}
                    onChange={(event) => setQuantity(event.target.value)}
                  />
                </Field>
                {itemId && (
                  <SupplierAvailability
                    key={itemId}
                    itemId={itemId}
                    supplierId={supplierId}
                  />
                )}
                {selected?.serial_tracking && (
                  <Field label="Unit serial numbers" wide>
                    <textarea
                      required
                      maxLength={130000}
                      autoCapitalize="off"
                      spellCheck={false}
                      placeholder="One available serial per returned unit, one per line"
                      value={serials}
                      readOnly
                    />
                    <small>
                      Scan another unit serial to increase the quantity. Clear
                      the item to start again.
                    </small>
                  </Field>
                )}
                <Field label="Reason for return" wide>
                  <textarea
                    required
                    minLength={3}
                    maxLength={255}
                    placeholder="e.g. Faulty item or incorrect part supplied"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                  />
                </Field>
              </>
            )}
            <Field label="Status" wide>
              <select
                required
                value={status}
                onChange={(event) =>
                  setStatus(event.target.value as SupplierReturnStatus)
                }
              >
                {returnStatuses.map((value) => (
                  <option key={value} value={value}>
                    {label(value)}
                  </option>
                ))}
              </select>
            </Field>
            <p className="notice wide" role="status">
              {effect}
            </p>
          </fieldset>
          <div className="modal-footer">
            <Button
              variant="secondary"
              type="button"
              disabled={busy || resolving}
              onClick={close}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={busy || resolving || (!entry && !selected)}
            >
              <Check size={16} />
              {busy
                ? "Saving…"
                : uncertain
                  ? "Retry same request"
                  : entry
                    ? "Update status"
                    : "Add return"}
            </Button>
          </div>
        </form>
      </Modal>
      {scanning && (
        <BarcodeScanner
          close={() => setScanning(false)}
          onConfirm={(value) => {
            setScanning(false);
            void lookupBarcode(value);
          }}
        />
      )}
    </>
  );
}

function SupplierAvailability({
  itemId,
  supplierId,
}: {
  itemId: string;
  supplierId: string;
}) {
  const detail = useLoad<ItemDetail>(`/items/${itemId}`);
  const supplierStock = detail.data?.supplier_stock.find(
    (row) => row.supplier_id === Number(supplierId),
  );
  const available =
    supplierStock?.available_quantity ?? supplierStock?.quantity ?? 0;
  return (
    <div className="wide">
      <ErrorBox message={detail.error} />
      {detail.error && (
        <Button type="button" variant="secondary" onClick={detail.reload}>
          Retry supplier stock
        </Button>
      )}
      {supplierId && (
        <small>
          {detail.loading
            ? "Checking supplier stock…"
            : `${available} unit(s) available from this supplier.`}
        </small>
      )}
    </div>
  );
}
