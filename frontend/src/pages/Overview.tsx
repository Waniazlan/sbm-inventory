import { useState } from "react";

import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpFromLine,
  BarChart3,
  Layers,
  Package,
  Plus,
  ShieldCheck,
  TriangleAlert,
  Wrench,
} from "lucide-react";
import { NavLink } from "react-router-dom";
import { money, type Item, type Movement } from "../api";

import {
  Button,
  Empty,
  Heading,
  MovementTable,
  Status,
} from "../components/shared";
import { StockForm } from "../components/StockForm";
import { useApp, useLoad } from "../hooks";
export function Overview() {
  const { user } = useApp();
  const q = useLoad<{
    items: number;
    units: number;
    low_stock: number;
    out_of_stock: number;
    valuation: number | null;
    recent: Movement[];
    low_items: Item[];
  }>("/dashboard");
  const [action, setAction] = useState("");
  return (
    <>
      <Heading
        title="Stock overview"
        subtitle="A clear picture of your parts, stock and daily movements."
        actions={
          user.role === "admin" ? (
            <Button onClick={() => setAction("receipt")}>
              <Plus size={17} />
              Receive stock
            </Button>
          ) : (
            <Button onClick={() => setAction("repair_usage")}>
              <Wrench size={17} />
              Record usage
            </Button>
          )
        }
      />
      <Status {...q} retry={q.reload}>
        {q.data && (
          <>
            <div className="stats">
              {[
                {
                  name: "Active items",
                  value: q.data.items,
                  icon: Package,
                  note: "Parts in your catalogue",
                },
                {
                  name: "Units on hand",
                  value: q.data.units,
                  icon: Layers,
                  note: "Available across all items",
                },
                {
                  name: "Low stock",
                  value: q.data.low_stock,
                  icon: TriangleAlert,
                  note: `${q.data.out_of_stock} items out of stock`,
                  warn: true,
                },
                {
                  name:
                    user.role === "admin" ? "Stock value" : "Your workspace",
                  value:
                    user.role === "admin"
                      ? money(q.data.valuation)
                      : "Technician",
                  icon: user.role === "admin" ? BarChart3 : Wrench,
                  note:
                    user.role === "admin"
                      ? "At current standard cost"
                      : "Assigned repair consumption",
                },
              ].map((s) => (
                <div className={`stat ${s.warn ? "warn" : ""}`} key={s.name}>
                  <div>
                    <span>{s.name}</span>
                    <s.icon size={19} />
                  </div>
                  <strong>{s.value}</strong>
                  <small>{s.note}</small>
                </div>
              ))}
            </div>
            <div className="overview-grid">
              <section className="panel">
                <div className="panel-title">
                  <div>
                    <h2>Needs attention</h2>
                    <p>Items at or below their minimum level</p>
                  </div>
                  <NavLink to="/low-stock">
                    View all <ArrowRight size={14} />
                  </NavLink>
                </div>
                {q.data.low_items.length ? (
                  <div className="attention-list">
                    {q.data.low_items.map((i) => (
                      <div key={i.id}>
                        <div className="item-icon">
                          <Package size={20} />
                        </div>
                        <div>
                          <strong>{i.name}</strong>
                          <small>
                            {i.sku} · Minimum {i.minimum_stock}
                          </small>
                        </div>
                        <span
                          className={
                            "badge " + (i.stock === 0 ? "red" : "amber")
                          }
                        >
                          {i.stock} left
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Empty
                    title="Stock levels look good"
                    text="Items needing replenishment will appear here."
                  />
                )}
              </section>
              <section className="quick-panel">
                <span className="eyebrow">KEEP THINGS MOVING</span>
                <h2>
                  Every part.
                  <br />
                  Every movement.
                  <br />
                  Accounted for.
                </h2>
                <p>
                  Record stock when it arrives or is used. Your ledger keeps the
                  full story.
                </p>
                <div>
                  {user.role === "admin" ? (
                    <>
                      <Button onClick={() => setAction("receipt")}>
                        <ArrowDownToLine size={18} />
                        Receive stock
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => setAction("manual_out")}
                      >
                        <ArrowUpFromLine size={18} />
                        Issue or adjust
                      </Button>
                    </>
                  ) : (
                    <Button onClick={() => setAction("repair_usage")}>
                      Record repair usage
                    </Button>
                  )}
                </div>
                <div className="ledger-mark">
                  <ShieldCheck size={17} />
                  Permanent movement history
                </div>
              </section>
            </div>
            <section className="panel">
              <div className="panel-title">
                <div>
                  <h2>Recent movements</h2>
                  <p>
                    {user.role === "admin"
                      ? "The latest changes to your inventory"
                      : "Your recorded stock usage"}
                  </p>
                </div>
                <NavLink to="/movements">
                  Full ledger <ArrowRight size={14} />
                </NavLink>
              </div>
              <MovementTable rows={q.data.recent.slice(0, 6)} />
            </section>
          </>
        )}
      </Status>
      {action && (
        <StockForm kind={action} close={() => setAction("")} done={q.reload} />
      )}
    </>
  );
}
