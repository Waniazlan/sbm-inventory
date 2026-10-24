import { useEffect, useState } from "react";
import { Printer } from "lucide-react";
import { errorText, type Item, type ItemUnit, type Page } from "../api";
import { useLoad } from "../hooks";
import { labelSymbol } from "../lib/labels";
import { Button, Empty, ErrorBox, Field, Modal, Pager, Status } from "./shared";

type Sticker = { value: string; serial?: string };
function StickerPreview({ item, sticker }: { item: Item; sticker: Sticker }) {
  const [symbol, setSymbol] = useState<{ src: string; format: string } | null>(
    null,
  );
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    setSymbol(null);
    setError("");
    labelSymbol(sticker.value)
      .then((value) => {
        if (live) setSymbol(value);
      })
      .catch((e) => {
        if (live) setError(errorText(e));
      });
    return () => {
      live = false;
    };
  }, [sticker.value]);
  return (
    <article className="barcode-sticker" data-ready={!!symbol}>
      <strong>{item.name}</strong>
      <span>{item.sku}</span>
      {symbol ? (
        <img
          className={symbol.format === "QRCode" ? "qr-label" : ""}
          src={symbol.src}
          alt={`${symbol.format}: ${sticker.value}`}
        />
      ) : (
        <span>{error || "Generating barcode…"}</span>
      )}
      <span className="label-value">
        {sticker.serial ? "S/N: " : ""}
        {sticker.value}
      </span>
      {sticker.serial && (
        <span className="label-product-code">
          Product: {item.barcode || item.sku}
        </span>
      )}
    </article>
  );
}

export function ItemLabels({ item, close }: { item: Item; close: () => void }) {
  const [mode, setMode] = useState("product");
  const [copies, setCopies] = useState(1);
  const [size, setSize] = useState("50x30");
  const [page, setPage] = useState(1);
  const [state, setState] = useState("available");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<ItemUnit[]>([]);
  const [error, setError] = useState("");
  const units = useLoad<Page<ItemUnit>>(
    `/items/${item.id}/units?page=${page}&state=${state}&search=${encodeURIComponent(search)}`,
  );
  const stickers: Sticker[] =
    mode === "product"
      ? item.barcode
        ? Array.from({ length: copies }, () => ({ value: item.barcode! }))
        : []
      : selected.map((unit) => ({
          value: unit.serial_number,
          serial: unit.serial_number,
        }));
  const [width, height] = size.split("x").map(Number);
  async function print() {
    setError("");
    const source = document.querySelector(".label-preview");
    if (
      !source ||
      !stickers.length ||
      source.querySelector('[data-ready="false"]')
    ) {
      setError("Wait for all labels to finish generating before printing.");
      return;
    }
    // A separate document keeps the app and modal out of the print job.
    const popup = window.open("", "_blank", "width=800,height=650");
    if (!popup) {
      setError("Allow pop-ups for this site to open the print preview.");
      return;
    }
    const doc = popup.document;
    doc.title = `${item.sku} labels`;
    const style = doc.createElement("style");
    style.textContent = `@page { size: ${width}mm ${height}mm; margin: 0; } * { box-sizing: border-box; } body { margin: 0; font-family: Arial,sans-serif; color: #000; background: #fff; } .barcode-sticker { width: ${width}mm; height: ${height}mm; padding: 2mm; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; overflow: hidden; break-after: page; } .barcode-sticker:last-child { break-after: auto; } strong { font-size: 9pt; max-width: 100%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; } span { font-size: 7pt; } img { width: 100%; height: ${height - 16}mm; object-fit: contain; } .qr-label { width: ${height - 16}mm; } .label-value { font-family: monospace; overflow-wrap: anywhere; font-size: 6.5pt; } .label-product-code { font-size: 6pt; } button { margin: 15px; padding: 10px; } @media print { button { display:none; } }`;
    doc.head.append(style);
    const button = doc.createElement("button");
    button.textContent = "Print stickers";
    button.onclick = () => popup.print();
    doc.body.append(button);
    for (const node of source.children)
      doc.body.append(doc.importNode(node, true));
    popup.opener = null;
    try {
      await Promise.all(Array.from(doc.images).map((img) => img.decode()));
      popup.focus();
      popup.print();
    } catch {
      setError(
        "Label images could not load. Close the print window and try again.",
      );
    }
  }
  return (
    <Modal
      title="Labels & serials"
      subtitle={`${item.name} · ${item.sku}`}
      close={close}
      className="item-labels-dialog"
    >
      <div className="labels-body">
        <ErrorBox message={error} />
        <div className="form-grid">
          <Field label="Label type">
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="product">Product barcode</option>
              {item.serial_tracking && (
                <option value="units">Individual unit serials</option>
              )}
            </select>
          </Field>
          <Field label="Sticker size">
            <select value={size} onChange={(e) => setSize(e.target.value)}>
              <option value="50x30">50 × 30 mm</option>
              <option value="60x40">60 × 40 mm</option>
              <option value="80x50">80 × 50 mm</option>
            </select>
          </Field>
          {mode === "product" && (
            <Field label="Number of stickers">
              <input
                type="number"
                min={1}
                max={100}
                value={copies}
                onChange={(e) =>
                  setCopies(
                    Math.min(
                      100,
                      Math.max(1, Math.floor(Number(e.target.value)) || 1),
                    ),
                  )
                }
              />
            </Field>
          )}
        </div>
        {mode === "product" ? (
          <p className="form-help">
            Use the same product barcode on every unit.{" "}
            {!item.barcode
              ? "Edit this item to assign or generate a store barcode first."
              : item.serial_tracking
                ? "Select individual unit serials to print a unique identifier for each physical unit."
                : "Enable individual serial tracking in Edit to identify each physical unit."}
          </p>
        ) : (
          <>
            <p className="form-help">
              Select units to print. Each sticker scans the unit's unique serial
              and shows its product code.
            </p>
            <div className="toolbar">
              <input
                aria-label="Search serial numbers"
                placeholder="Search serial numbers"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
              />
              <select
                aria-label="Unit status"
                value={state}
                onChange={(e) => {
                  setState(e.target.value);
                  setPage(1);
                }}
              >
                <option value="available">In stock</option>
                <option value="issued">Issued</option>
                <option value="">All units</option>
              </select>
            </div>
            <Status {...units} retry={units.reload}>
              {units.data?.data.length ? (
                <div className="table-scroll unit-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Select</th>
                        <th>Serial number</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {units.data.data.map((unit) => (
                        <tr key={unit.id}>
                          <td>
                            <input
                              type="checkbox"
                              aria-label={`Print ${unit.serial_number}`}
                              checked={selected.some((s) => s.id === unit.id)}
                              disabled={
                                selected.length >= 100 &&
                                !selected.some((s) => s.id === unit.id)
                              }
                              onChange={(e) =>
                                setSelected(
                                  e.target.checked
                                    ? [...selected, unit]
                                    : selected.filter((s) => s.id !== unit.id),
                                )
                              }
                            />
                          </td>
                          <td className="barcode-number">
                            {unit.serial_number}
                          </td>
                          <td>{unit.in_stock ? "In stock" : "Issued"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty
                  title="No units found"
                  text="Receive stock to register individual units and their serials."
                />
              )}
              <Pager page={units.data} setPage={setPage} />
            </Status>
            <div className="row-actions">
              <Button
                variant="secondary"
                onClick={() =>
                  setSelected((current) =>
                    [
                      ...current,
                      ...(units.data?.data || []).filter(
                        (u) => !current.some((s) => s.id === u.id),
                      ),
                    ].slice(0, 100),
                  )
                }
              >
                Select this page
              </Button>
              <Button variant="quiet" onClick={() => setSelected([])}>
                Clear selection ({selected.length})
              </Button>
            </div>
          </>
        )}
        <p className="form-help">
          Print at 100% scale with no margins or browser headers. Match the
          printer paper size to the selected sticker size. Save as PDF is also
          available in the print dialog.
        </p>
        <div
          className="label-preview"
          style={
            {
              "--sticker-width": `${width}mm`,
              "--sticker-height": `${height}mm`,
            } as React.CSSProperties
          }
        >
          {stickers.map((sticker, index) => (
            <StickerPreview
              key={`${sticker.value}-${index}`}
              item={item}
              sticker={sticker}
            />
          ))}
        </div>
      </div>
      <div className="modal-footer">
        <Button variant="secondary" onClick={close}>
          Close
        </Button>
        <Button disabled={!stickers.length} onClick={print}>
          <Printer size={17} />
          Print {stickers.length} sticker(s)
        </Button>
      </div>
    </Modal>
  );
}
