import { useState } from "react";

import {
  Barcode,
  PackagePlus,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { money, type Item, type Page } from "../api";

import { ItemLabels } from "../components/ItemLabels";
import { ItemForm } from "../components/ItemForm";
import { ItemDetails } from "../components/ItemDetails";
import { DeleteItem } from "../components/DeleteItem";
import {
  Button,
  Empty,
  Heading,
  Pager,
  Status,
  StockBadge,
} from "../components/shared";
import { StockForm } from "../components/StockForm";
import { useApp, useLoad } from "../hooks";
export function Catalogue({ low = false }: { low?: boolean }) {
  const { user, meta } = useApp();
  const [labels, setLabels] = useState<Item | null>(null);
  const [deleting, setDeleting] = useState<Item | null>(null);
  const [search, setSearch] = useState(""),
    [sort, setSort] = useState("newest"),
    [status, setStatus] = useState(low ? "low" : ""),
    [category, setCategory] = useState(""),
    [page, setPage] = useState(1),
    [edit, setEdit] = useState<Item | "new" | null>(null),
    [stock, setStock] = useState<{ kind: string; item: Item } | null>(null),
    [detail, setDetail] = useState<Item | null>(null);
  const q = useLoad<Page<Item>>(
    `/items?search=${encodeURIComponent(search)}&status=${status}&category_id=${category}&sort=${sort}&page=${page}`,
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
          <>
            {user.role === "admin" && (
              <Button onClick={() => setEdit("new")}>
                <Plus size={17} />
                Add item
              </Button>
            )}
          </>
        }
      />
      <section className="panel">
        <div className="toolbar">
          <div className="search">
            <Search size={18} />
            <input
              aria-label="Search catalogue"
              placeholder="Search barcode, serial, name, SKU, brand, model or supplier…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <label className="catalogue-sort">
            <span>Sort by</span>
            <select
              value={sort}
              onChange={(e) => {
                setSort(e.target.value);
                setPage(1);
              }}
            >
              <option value="newest">Newest first</option>
              <option value="modified">Latest modified</option>
              <option value="oldest">Oldest first</option>
              <option value="name_asc">Name: A–Z</option>
              <option value="name_desc">Name: Z–A</option>
              <option value="stock_desc">Stock: high to low</option>
              <option value="stock_asc">Stock: low to high</option>
            </select>
          </label>
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
                        <small className="barcode-number">
                          Barcode: {i.barcode || "Not assigned"}
                        </small>
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
                        {!!i.frozen_stock && (
                          <small>
                            {i.frozen_stock} frozen · {i.available_stock}{" "}
                            available
                          </small>
                        )}
                      </td>
                      <td>
                        <StockBadge item={i} />
                      </td>
                      <td>{money(i.price)}</td>
                      <td>
                        <div className="row-actions">
                          <Button
                            variant="secondary"
                            className="catalogue-action"
                            aria-label="Labels & serials"
                            onClick={() => setLabels(i)}
                          >
                            <Barcode size={17} aria-hidden="true" />
                          </Button>
                          {user.role === "admin" && (
                            <>
                              <Button
                                variant="secondary"
                                className="catalogue-action"
                                aria-label="Edit"
                                onClick={() => setEdit(i)}
                              >
                                <Pencil size={17} aria-hidden="true" />
                              </Button>
                              <Button
                                variant="secondary"
                                className="catalogue-action"
                                aria-label="Receive"
                                onClick={() =>
                                  setStock({ kind: "receipt", item: i })
                                }
                              >
                                <PackagePlus size={17} aria-hidden="true" />
                              </Button>
                              <Button
                                variant="danger"
                                className="catalogue-action"
                                aria-label="Delete"
                                onClick={() => setDeleting(i)}
                              >
                                <Trash2 size={17} aria-hidden="true" />
                              </Button>
                            </>
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
      {deleting && (
        <DeleteItem
          item={deleting}
          close={() => setDeleting(null)}
          done={() => {
            setDeleting(null);
            if (q.data?.data.length === 1 && page > 1) setPage(page - 1);
            else q.reload();
          }}
        />
      )}
      {labels && <ItemLabels item={labels} close={() => setLabels(null)} />}
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
        <ItemDetails
          key={detail.id}
          item={detail}
          changed={q.reload}
          close={() => setDetail(null)}
          issue={(item) => {
            setStock({ kind: "manual_out", item });
            setDetail(null);
          }}
        />
      )}
    </>
  );
}
