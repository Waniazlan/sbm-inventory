import React, { useEffect, useRef } from "react";

import {
  ChevronLeft,
  ChevronRight,
  Package,
  TriangleAlert,
  X,
} from "lucide-react";
import { label, type Item, type Movement, type Page } from "../api";

import { useApp } from "../hooks";
export function Button({
  children,
  variant = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }) {
  return (
    <button {...props} className={`button ${variant} ${props.className || ""}`}>
      {children}
    </button>
  );
}
export function Field({
  label: caption,
  children,
  wide = false,
}: {
  label: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <label className={`field ${wide ? "wide" : ""}`}>
      <span>{caption}</span>
      {children}
    </label>
  );
}
export function ErrorBox({ message }: { message: string }) {
  return message ? (
    <div className="error" role="alert">
      <TriangleAlert size={17} />
      {message}
    </div>
  ) : null;
}
export function Empty({
  title = "Nothing here yet",
  text = "Your records will appear here as you start working.",
}: {
  title?: string;
  text?: string;
}) {
  return (
    <div className="empty">
      <Package size={30} />
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
export function Status({
  loading,
  error,
  retry,
  children,
}: {
  loading: boolean;
  error: string;
  retry: () => void;
  children: React.ReactNode;
}) {
  return error ? (
    <>
      <ErrorBox message={error} />
      <Button onClick={retry}>Try again</Button>
    </>
  ) : loading ? (
    <div className="loading">Loading inventory…</div>
  ) : (
    <>{children}</>
  );
}
export function Pager({
  page,
  setPage,
}: {
  page: Page<unknown> | null;
  setPage: (p: number) => void;
}) {
  return page ? (
    <div className="pager">
      <span>
        {page.total} records · Page {page.current_page} of {page.last_page}
      </span>
      <div>
        <Button
          variant="quiet"
          disabled={page.current_page <= 1}
          onClick={() => setPage(page.current_page - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft size={16} />
        </Button>
        <Button
          variant="quiet"
          disabled={page.current_page >= page.last_page}
          onClick={() => setPage(page.current_page + 1)}
          aria-label="Next page"
        >
          <ChevronRight size={16} />
        </Button>
      </div>
    </div>
  ) : null;
}
export function Modal({
  title,
  subtitle,
  close,
  children,
}: {
  title: string;
  subtitle?: string;
  close: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <div className="modal-head">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={close}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Heading({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="heading">
      <div>
        <span className="eyebrow">INVENTORY WORKSPACE</span>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      <div className="actions">{actions}</div>
    </div>
  );
}
export function StockBadge({ item }: { item: Item }) {
  return (
    <span
      className={`badge ${!item.active ? "neutral" : item.stock === 0 ? "red" : item.stock <= item.minimum_stock ? "amber" : "green"}`}
    >
      {!item.active
        ? "Inactive"
        : item.stock === 0
          ? "Out of stock"
          : item.stock <= item.minimum_stock
            ? "Low stock"
            : "In stock"}
    </span>
  );
}
export function Time({ value }: { value: string }) {
  const { meta } = useApp();
  return (
    <>
      {new Intl.DateTimeFormat("en-MY", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: meta.timezone,
      }).format(new Date(value))}
    </>
  );
}
export function MovementTable({
  rows,
  onReverse,
}: {
  rows: Movement[];
  onReverse?: (m: Movement) => void;
}) {
  return rows.length ? (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th>Movement</th>
            <th>Quantity</th>
            <th>Balance</th>
            <th>Reference / reason</th>
            <th>Recorded by</th>
            <th>Date</th>
            {onReverse && <th />}
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.id}>
              <td>
                <strong>{m.item.name}</strong>
                <small>
                  {m.item.sku} · #{m.id}
                </small>
              </td>
              <td>
                <span className="badge neutral">{label(m.type)}</span>
                {m.reversal && <small>Reversed by #{m.reversal.id}</small>}
              </td>
              <td className={m.delta > 0 ? "positive" : "negative"}>
                <b>
                  {m.delta > 0 ? "+" : ""}
                  {m.delta}
                </b>
              </td>
              <td>
                {m.balance_before} → {m.balance_after}
              </td>
              <td>
                <strong>{m.reference || "Manual entry"}</strong>
                <small>{m.reason}</small>
              </td>
              <td>{m.actor?.name || m.actor_reference || m.source}</td>
              <td className="date">
                <Time value={m.occurred_at} />
              </td>
              {onReverse && (
                <td>
                  {!m.reversal && !m.reverses_id && (
                    <Button variant="quiet" onClick={() => onReverse(m)}>
                      Reverse
                    </Button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty
      title="No movements found"
      text="Receipts, issues and adjustments will build your stock history."
    />
  );
}
