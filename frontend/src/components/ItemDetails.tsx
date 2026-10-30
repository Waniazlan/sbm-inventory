import { useState } from "react";
import {
  money,
  type Item,
  type ItemDetail,
  type SupplierStockEntry,
} from "../api";
import { useApp, useLoad } from "../hooks";
import { Button, Empty, Modal, Status } from "./shared";
import { SupplierStockEditor } from "./SupplierStockEditor";

export function ItemDetails({
  item,
  close,
  issue,
  changed,
}: {
  item: Item;
  close: () => void;
  issue: (item: Item) => void;
  changed: () => void;
}) {
  const { user, notify } = useApp();
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{
    entry: SupplierStockEntry;
    supplierId: number | null;
    supplierName: string;
  } | null>(null);
  const detail = useLoad<ItemDetail>(`/items/${item.id}`);
  const product = detail.data;
  return (
    <Modal
      className="item-details-dialog"
      title={product?.name || item.name}
      subtitle={product?.sku || item.sku}
      close={() => {
        if (!busy) close();
      }}
    >
      <div className="item-details-body">
        <Status {...detail} retry={detail.reload}>
          {product && (
            <>
              <div className="detail-grid">
                {Object.entries({
                  Status: product.active ? "Active" : "Inactive",
                  Barcode: product.barcode || "Not assigned",
                  Stock: `${product.stock} ${product.unit}(s)`,
                  ...(product.frozen_stock
                    ? {
                        "Frozen for supplier returns": product.frozen_stock,
                        "Available stock": product.available_stock,
                      }
                    : {}),
                  Part: product.part_number,
                  Colour: product.colour,
                  Grade: product.grade,
                  Capacity: product.capacity,
                  "Selling price": money(product.price),
                  ...(user.role === "admin"
                    ? { "Stock value": money(product.stock_value) }
                    : {}),
                  Notes: product.notes,
                }).map(([key, value]) => (
                  <div key={key}>
                    <small>{key}</small>
                    <strong>{value || "—"}</strong>
                  </div>
                ))}
              </div>
              <section
                className="supplier-stock"
                aria-label="Stock by supplier"
              >
                <h3>Stock by supplier</h3>
                <p className="muted">
                  Current quantities by supplier and received part brand.
                </p>
                {product.supplier_stock.length ? (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Supplier</th>
                          <th>Part brand</th>
                          <th>On hand</th>
                        </tr>
                      </thead>
                      <tbody>
                        {product.supplier_stock.flatMap((stock) =>
                          stock.brands.map((entry) => (
                            <tr
                              key={JSON.stringify([
                                stock.supplier_id,
                                entry.brand,
                              ])}
                            >
                              <td>
                                {stock.supplier_name || "Supplier not recorded"}
                              </td>
                              <td>{entry.brand || "Brand not recorded"}</td>
                              <td>
                                <strong>
                                  {entry.quantity} {product.unit}(s)
                                </strong>
                                {user.role === "admin" && (
                                  <div className="supplier-stock-actions">
                                    <Button
                                      variant="secondary"
                                      disabled={
                                        busy || !!editing || !entry.edit_token
                                      }
                                      onClick={() =>
                                        setEditing({
                                          entry,
                                          supplierId: stock.supplier_id,
                                          supplierName:
                                            stock.supplier_name ||
                                            "Supplier not recorded",
                                        })
                                      }
                                    >
                                      Edit
                                    </Button>
                                  </div>
                                )}
                              </td>
                            </tr>
                          )),
                        )}
                      </tbody>
                      <tfoot>
                        <tr>
                          <th colSpan={2}>Total on hand</th>
                          <th>
                            {product.stock} {product.unit}(s)
                          </th>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                ) : (
                  <Empty
                    title="No stock on hand"
                    text="There is no remaining stock from any supplier."
                  />
                )}
                {editing && (
                  <SupplierStockEditor
                    item={product}
                    {...editing}
                    onBusy={setBusy}
                    cancel={() => {
                      setEditing(null);
                      detail.reload();
                    }}
                    done={() => {
                      setEditing(null);
                      detail.reload();
                      changed();
                      notify("Supplier stock updated.");
                    }}
                  />
                )}
              </section>
            </>
          )}
        </Status>
      </div>
      <div className="modal-footer">
        {user.role === "admin" && !editing && (
          <Button
            disabled={!product || detail.loading || !!detail.error}
            onClick={() => product && issue(product)}
          >
            Issue or adjust stock
          </Button>
        )}
        <Button variant="secondary" disabled={busy} onClick={close}>
          Close
        </Button>
      </div>
    </Modal>
  );
}
