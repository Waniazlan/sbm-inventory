import { useState } from "react";

import { Camera, Plus, Search } from "lucide-react";
import { money, type Item, type Page } from "../api";

import { ItemLabels } from "../components/ItemLabels";
import { ItemForm } from "../components/ItemForm";
import { ItemDetails } from "../components/ItemDetails";
import { DeleteItem } from "../components/DeleteItem";
import { BarcodeScanner } from "../components/BarcodeScanner";
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
  const [scanning, setScanning] = useState(false);
  const [scannedBarcode, setScannedBarcode] = useState("");
  const [search, setSearch] = useState(""),
    [sort, setSort] = useState("newest"),
    [status, setStatus] = useState(low ? "low" : ""),
    [category, setCategory] = useState(""),
    [page, setPage] = useState(1),
    [edit, setEdit] = useState<Item | "new" | null>(null),
    [stock, setStock] = useState<{ kind: string; item: Item } | null>(null),
    [detail, setDetail] = useState<Item | null>(null);
  const q = useLoad<Page<Item>>(
    scannedBarcode
      ? `/items?barcode=${encodeURIComponent(scannedBarcode)}&sort=${sort}&page=${page}`
      : `/items?search=${encodeURIComponent(search)}&status=${status}&category_id=${category}&sort=${sort}&page=${page}`,
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
            <Button variant="secondary" onClick={() => setScanning(true)}>
              <Camera size={17} /> Scan barcode
            </Button>
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
                setScannedBarcode("");
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
              setScannedBarcode("");
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
                setScannedBarcode("");
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
        {scannedBarcode && (
          <div className="barcode-lookup" role="status">
            <span>
              Exact barcode / serial: <strong>{scannedBarcode}</strong> ·
              Searching all items
            </span>
            <Button
              variant="quiet"
              onClick={() => {
                setScannedBarcode("");
                setSearch("");
                setPage(1);
              }}
            >
              Clear scan
            </Button>
          </div>
        )}
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
                      </td>
                      <td>
                        <StockBadge item={i} />
                      </td>
                      <td>{money(i.price)}</td>
                      <td>
                        <div className="row-actions">
                          <Button
                            variant="secondary"
                            onClick={() => setLabels(i)}
                          >
                            Labels &amp; serials
                          </Button>
                          {user.role === "admin" && (
                            <>
                              <Button
                                variant="secondary"
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
                              <Button
                                variant="danger"
                                onClick={() => setDeleting(i)}
                              >
                                Delete
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
              title={
                scannedBarcode
                  ? "Barcode not assigned"
                  : search
                    ? "No matching items"
                    : "No items to display"
              }
              text={
                scannedBarcode
                  ? `No item has barcode ${scannedBarcode}. ${user.role === "admin" ? "Add an item or edit an existing item to assign it." : "Ask an administrator to assign it to an item."}`
                  : low
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
      {scanning && (
        <BarcodeScanner
          lookup
          close={() => setScanning(false)}
          onConfirm={(value) => {
            setScannedBarcode(value);
            setSearch(value);
            setPage(1);
            setScanning(false);
          }}
        />
      )}
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
