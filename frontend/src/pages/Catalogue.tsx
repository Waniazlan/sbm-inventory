import { useState } from "react";

import { Plus, Search } from "lucide-react";
import { money, type Item, type Page } from "../api";

import { ItemForm } from "../components/ItemForm";
import {
  Button,
  Empty,
  Heading,
  Modal,
  Pager,
  Status,
  StockBadge,
} from "../components/shared";
import { StockForm } from "../components/StockForm";
import { useApp, useLoad } from "../hooks";
export function Catalogue({ low = false }: { low?: boolean }) {
  const { user, meta } = useApp();
  const [search, setSearch] = useState(""),
    [status, setStatus] = useState(low ? "low" : ""),
    [category, setCategory] = useState(""),
    [page, setPage] = useState(1),
    [edit, setEdit] = useState<Item | "new" | null>(null),
    [stock, setStock] = useState<{ kind: string; item: Item } | null>(null),
    [detail, setDetail] = useState<Item | null>(null);
  const q = useLoad<Page<Item>>(
    `/items?search=${encodeURIComponent(search)}&status=${status}&category_id=${category}&page=${page}`,
  );
  return (
    <>
      <Heading
        title={low ? "Low-stock watch" : "Item catalogue"}
        subtitle={
          low
            ? "Plan replenishment before a missing part slows down a repair."
            : "Your spare parts and accessories, organised by compatibility."
        }
        actions={
          user.role === "admin" && (
            <Button onClick={() => setEdit("new")}>
              <Plus size={17} />
              Add item
            </Button>
          )
        }
      />
      <section className="panel">
        <div className="toolbar">
          <div className="search">
            <Search size={18} />
            <input
              aria-label="Search catalogue"
              placeholder="Search name, SKU, brand, model or supplier…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <select
            aria-label="Category"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All categories</option>
            {meta.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {!low && (
            <select
              aria-label="Stock status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All stock levels</option>
              <option value="available">In stock</option>
              <option value="low">Low stock</option>
              <option value="out">Out of stock</option>
              <option value="inactive">Inactive</option>
            </select>
          )}
        </div>
        <Status {...q} retry={q.reload}>
          {q.data?.data.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Item / SKU</th>
                    <th>Compatibility</th>
                    <th>Category</th>
                    <th>On hand</th>
                    <th>Status</th>
                    <th>Price</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {q.data.data.map((i) => (
                    <tr key={i.id}>
                      <td>
                        <button
                          className="text-button"
                          onClick={() => setDetail(i)}
                        >
                          {i.name}
                        </button>
                        <small>{i.sku}</small>
                      </td>
                      <td>
                        {i.phone_models.length
                          ? i.phone_models
                              .map((p) => `${p.brand} ${p.name}`)
                              .join(", ")
                          : "—"}
                      </td>
                      <td>{i.category.name}</td>
                      <td>
                        <b>{i.stock}</b>{" "}
                        <small className="inline">{i.unit}(s)</small>
                        <small>Min. {i.minimum_stock}</small>
                      </td>
                      <td>
                        <StockBadge item={i} />
                      </td>
                      <td>{money(i.price)}</td>
                      <td>
                        <div className="row-actions">
                          {user.role === "admin" ? (
                            <>
                              <Button
                                variant="quiet"
                                onClick={() => setEdit(i)}
                              >
                                Edit
                              </Button>
                              <Button
                                variant="secondary"
                                onClick={() =>
                                  setStock({ kind: "receipt", item: i })
                                }
                              >
                                Receive
                              </Button>
                            </>
                          ) : (
                            <Button
                              variant="secondary"
                              onClick={() =>
                                setStock({ kind: "repair_usage", item: i })
                              }
                            >
                              Use part
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              title={search ? "No matching items" : "No items to display"}
              text={
                low
                  ? "Items will appear when they reach the configured minimum."
                  : "Add an item, map compatible models, then record its first receipt."
              }
            />
          )}
          <Pager page={q.data} setPage={setPage} />
        </Status>
      </section>
      {edit && (
        <ItemForm
          item={edit === "new" ? undefined : edit}
          close={() => setEdit(null)}
          done={q.reload}
        />
      )}{" "}
      {stock && (
        <StockForm {...stock} close={() => setStock(null)} done={q.reload} />
      )}{" "}
      {detail && (
        <Modal
          title={detail.name}
          subtitle={detail.sku}
          close={() => setDetail(null)}
        >
          <div className="detail-grid">
            {Object.entries({
              Status: detail.active ? "Active" : "Inactive",
              Stock: `${detail.stock} ${detail.unit}(s)`,
              Brand: detail.brand,
              Part: detail.part_number,
              Colour: detail.colour,
              Grade: detail.grade,
              Capacity: detail.capacity,
              Supplier: detail.supplier?.name,
              "Selling price": money(detail.price),
              ...(user.role === "admin"
                ? { "Standard cost": money(detail.cost) }
                : {}),
              Notes: detail.notes,
            }).map(([k, v]) => (
              <div key={k}>
                <small>{k}</small>
                <strong>{v || "—"}</strong>
              </div>
            ))}
          </div>
          <div className="modal-footer">
            {user.role === "admin" && (
              <Button
                onClick={() => {
                  setStock({ kind: "manual_out", item: detail });
                  setDetail(null);
                }}
              >
                Issue or adjust stock
              </Button>
            )}
            <Button variant="secondary" onClick={() => setDetail(null)}>
              Close
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
