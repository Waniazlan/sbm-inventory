import { useState } from "react";
import { Plus, Search } from "lucide-react";
import { label, type Page, type SupplierReturn } from "../api";
import { useApp, useLoad } from "../hooks";
import {
  Button,
  Empty,
  Heading,
  Pager,
  Status,
  Time,
} from "../components/shared";
import { SupplierReturnForm } from "../components/SupplierReturnForm";
import { returnNumber, returnStatuses } from "../lib/supplier-returns";

export function SupplierReturns() {
  const { meta } = useApp();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [supplier, setSupplier] = useState("");
  const [page, setPage] = useState(1);
  const [form, setForm] = useState<SupplierReturn | "new" | null>(null);
  const records = useLoad<Page<SupplierReturn>>(
    `/supplier-returns?${new URLSearchParams({ search, status, supplier_id: supplier, page: String(page) })}`,
  );

  return (
    <>
      <Heading
        title="Supplier returns"
        subtitle="Track items returned to suppliers and their progress."
        actions={
          <Button onClick={() => setForm("new")}>
            <Plus size={17} /> Add supplier return
          </Button>
        }
      />
      <p className="notice">
        Process freezes stock from use. Delivered and Rejected deduct the frozen
        quantity from stock.
      </p>
      <section className="panel">
        <div className="toolbar">
          <div className="search">
            <Search size={17} />
            <input
              aria-label="Search supplier returns"
              placeholder="Search item, supplier or return number"
              maxLength={200}
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
          </div>
          <select
            aria-label="Return status"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
          >
            <option value="">All statuses</option>
            {returnStatuses.map((value) => (
              <option key={value} value={value}>
                {label(value)}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by supplier"
            value={supplier}
            onChange={(event) => {
              setSupplier(event.target.value);
              setPage(1);
            }}
          >
            <option value="">All suppliers</option>
            {meta.suppliers.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
        </div>
        <Status {...records} retry={records.reload}>
          {records.data?.data.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Return</th>
                    <th>Item</th>
                    <th>Supplier</th>
                    <th>Quantity</th>
                    <th>Status</th>
                    <th>Reason</th>
                    <th>Recorded by / date</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {records.data.data.map((entry) => (
                    <tr key={entry.id}>
                      <td>
                        <strong>{returnNumber(entry.id)}</strong>
                      </td>
                      <td>
                        <strong>{entry.item.name}</strong>
                        <small>{entry.item.sku}</small>
                      </td>
                      <td>{entry.supplier.name}</td>
                      <td>
                        <strong>{entry.quantity}</strong>
                        <small>{entry.item.unit}(s)</small>
                      </td>
                      <td>
                        <span
                          className={`badge ${entry.status === "process" ? "amber" : entry.status === "delivered" ? "green" : "red"}`}
                        >
                          {label(entry.status)}
                        </span>
                      </td>
                      <td>{entry.reason}</td>
                      <td className="date">
                        <strong>{entry.creator.name}</strong>
                        <small>
                          <Time value={entry.created_at} />
                        </small>
                      </td>
                      <td>
                        <div className="row-actions supplier-return-actions">
                          <Button
                            variant="quiet"
                            aria-label={`Update ${returnNumber(entry.id)}`}
                            onClick={() => setForm(entry)}
                          >
                            Update status
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              title="No supplier returns found"
              text="Add a supplier return to record an item and track its status."
            />
          )}
          <Pager page={records.data} setPage={setPage} />
        </Status>
      </section>
      {form && (
        <SupplierReturnForm
          entry={form === "new" ? undefined : form}
          close={() => setForm(null)}
          done={() => {
            if (form === "new") setPage(1);
            records.reload();
          }}
        />
      )}
    </>
  );
}
