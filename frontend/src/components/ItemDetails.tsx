import { money, type Item, type ItemDetail } from "../api";
import { useApp, useLoad } from "../hooks";
import { Button, Empty, Modal, Status } from "./shared";

export function ItemDetails({
  item,
  close,
  issue,
}: {
  item: Item;
  close: () => void;
  issue: (item: Item) => void;
}) {
  const { user } = useApp();
  const detail = useLoad<ItemDetail>(`/items/${item.id}`);
  const product = detail.data;
  return (
    <Modal
      title={product?.name || item.name}
      subtitle={product?.sku || item.sku}
      close={close}
    >
      <Status {...detail} retry={detail.reload}>
        {product && (
          <>
            <div className="detail-grid">
              {Object.entries({
                Status: product.active ? "Active" : "Inactive",
                Barcode: product.barcode || "Not assigned",
                Stock: `${product.stock} ${product.unit}(s)`,
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
            <section className="supplier-stock" aria-label="Stock by supplier">
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
            </section>
          </>
        )}
      </Status>
      <div className="modal-footer">
        {user.role === "admin" && (
          <Button
            disabled={!product || detail.loading || !!detail.error}
            onClick={() => product && issue(product)}
          >
            Issue or adjust stock
          </Button>
        )}
        <Button variant="secondary" onClick={close}>
          Close
        </Button>
      </div>
    </Modal>
  );
}
