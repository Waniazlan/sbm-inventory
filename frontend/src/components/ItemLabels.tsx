import { useEffect, useRef, useState } from "react";
import { Printer } from "lucide-react";
import { errorText, type Item, type ItemUnit, type Page } from "../api";
import { useLoad } from "../hooks";
import { labelSymbol, type LabelSymbol } from "../lib/labels";
import "./item-labels.css";
import stickerStyles from "./item-labels.css?inline";
import { Button, Empty, ErrorBox, Field, Modal, Pager, Status } from "./shared";

type Sticker = { value: string; serial?: string; brand?: string | null };
function StickerPreview({
  item,
  sticker,
  width,
  height,
}: {
  item: Item;
  sticker: Sticker;
  width: number;
  height: number;
}) {
  const [symbol, setSymbol] = useState<LabelSymbol | null>(null);
  const [error, setError] = useState("");
  const brand = sticker.serial ? sticker.brand?.trim() : undefined;
  const symbolHeight = Math.min(32, height - (sticker.serial ? 21 : 18));
  // Leave more room beside landscape QR codes for the complete serial.
  // On 50 × 30 mm stock, reserve 22 mm for QR and 23 mm for text.
  const qrSize = Math.min(28, height - 8, width - 27);
  const sideBySide = width >= height * 1.5 && qrSize > symbolHeight;
  const qrLayout = sideBySide && symbol?.format === "QRCode";
  useEffect(() => {
    let live = true;
    setSymbol(null);
    setError("");
    labelSymbol(
      sticker.value,
      { widthMm: width - 4, heightMm: symbolHeight },
      sideBySide ? { widthMm: qrSize, heightMm: qrSize } : undefined,
    )
      .then((value) => {
        if (live) setSymbol(value);
      })
      .catch((e) => {
        if (live) setError(errorText(e));
      });
    return () => {
      live = false;
    };
  }, [sticker.value, width, symbolHeight, sideBySide, qrSize]);
  return (
    <article
      className={`barcode-sticker${qrLayout ? " barcode-sticker-qr" : ""}${brand ? " barcode-sticker-branded" : ""}`}
      data-ready={!!symbol}
      style={
        qrLayout
          ? { gridTemplateColumns: `${qrSize}mm minmax(0, 1fr)` }
          : undefined
      }
    >
      <strong>{item.name}</strong>
      {brand && <span className="label-brand">{brand}</span>}
      <span className="label-sku">{item.sku}</span>
      <div
        className="label-symbol"
        style={{ height: `${qrLayout ? qrSize : symbolHeight}mm` }}
      >
        {symbol ? (
          <img
            className={symbol.format === "QRCode" ? "qr-label" : ""}
            src={symbol.src}
            style={{
              width: `${symbol.widthMm}mm`,
              height: `${symbol.heightMm}mm`,
            }}
            alt={`${symbol.format}: ${sticker.value}`}
          />
        ) : (
          <span>{error || "Generating barcode…"}</span>
        )}
      </div>
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
  const [customWidth, setCustomWidth] = useState("50");
  const [customHeight, setCustomHeight] = useState("30");
  const [page, setPage] = useState(1);
  const [state, setState] = useState("available");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<ItemUnit[]>([]);
  const [error, setError] = useState("");
  const preview = useRef<HTMLDivElement>(null);
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
          brand: unit.brand,
        }));
  const [width, height] =
    size === "custom"
      ? [Number(customWidth), Number(customHeight)]
      : size.split("x").map(Number);
  const validSize =
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width >= 20 &&
    width <= 108 &&
    height >= 25 &&
    height <= 1778;
  async function print() {
    setError("");
    if (!validSize) return;
    const source = preview.current;
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
    doc.title = `${item.sku} · XP-460B · ${width} × ${height} mm`;
    const style = doc.createElement("style");
    style.textContent = `
      @page { size: ${width}mm ${height}mm; margin: 0; }
      :root { --sticker-width: ${width}mm; --sticker-height: ${height}mm; }
      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; color: #000; background: #fff; }
      ${stickerStyles}
      .print-controls { margin: 16px; font: 14px Arial, sans-serif; }
      .print-controls button { padding: 10px; }
      @media print { .print-controls { display: none; } }
    `;
    doc.head.append(style);
    const controls = doc.createElement("div");
    controls.className = "print-controls";
    const instructions = doc.createElement("p");
    instructions.textContent = `Xprinter XP-460B · One sticker: ${width} mm across the roll × ${height} mm along the feed. Set the same dimensions in the driver, 100% scale, rotation 0°, no auto-rotation, margins, headers or footers. For gap labels, select gap media and calibrate the loaded roll. Use one copy in the print dialog; this document already contains ${stickers.length} label(s).`;
    controls.append(instructions);
    const button = doc.createElement("button");
    button.textContent = "Print stickers";
    button.onclick = () => popup.print();
    controls.append(button);
    doc.body.append(controls);
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
          <Field label="Sticker size (one label)">
            <select value={size} onChange={(e) => setSize(e.target.value)}>
              <option value="30x30">30 × 30 mm</option>
              <option value="35x35">35 × 35 mm</option>
              <option value="50x30">50 × 30 mm</option>
              <option value="60x40">60 × 40 mm</option>
              <option value="80x50">80 × 50 mm</option>
              <option value="76x130">76 × 130 mm</option>
              <option value="custom">Custom size…</option>
            </select>
          </Field>
          {size === "custom" && (
            <>
              <Field label="Width across roll (mm)">
                <input
                  type="number"
                  min={20}
                  max={108}
                  step={0.1}
                  value={customWidth}
                  onChange={(e) => setCustomWidth(e.target.value)}
                />
              </Field>
              <Field label="Length along feed (mm)">
                <input
                  type="number"
                  min={25}
                  max={1778}
                  step={0.1}
                  value={customHeight}
                  onChange={(e) => setCustomHeight(e.target.value)}
                />
              </Field>
            </>
          )}
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
        <p className="form-help">
          Measure one peel-off sticker, excluding the gaps. Width goes across
          the roll; length follows the paper feed. Do not use the length of a
          strip containing several stickers.
        </p>
        {!validSize && (
          <ErrorBox message="Enter a width from 20 to 108 mm and a feed length from 25 to 1778 mm." />
        )}
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
        {validSize && (
          <p className="form-help">
            Xprinter XP-460B · 203 DPI. Set the printer driver paper size to{" "}
            {width}
            {" × "}
            {height} mm, 100% scale, rotation 0°, no auto-rotation or margins,
            and turn off browser headers and footers. Each page prints one
            sticker. For gap labels, select gap media in the driver and
            calibrate the loaded roll. Save as PDF is also available in the
            print dialog.
          </p>
        )}
        <div
          ref={preview}
          className="label-preview"
          style={
            {
              "--sticker-width": `${width}mm`,
              "--sticker-height": `${height}mm`,
            } as React.CSSProperties
          }
        >
          {validSize &&
            stickers.map((sticker, index) => (
              <StickerPreview
                key={`${sticker.value}-${index}-${width}x${height}`}
                item={item}
                sticker={sticker}
                width={width}
                height={height}
              />
            ))}
        </div>
      </div>
      <div className="modal-footer">
        <Button variant="secondary" onClick={close}>
          Close
        </Button>
        <Button disabled={!stickers.length || !validSize} onClick={print}>
          <Printer size={17} />
          Print {stickers.length} sticker(s)
        </Button>
      </div>
    </Modal>
  );
}
