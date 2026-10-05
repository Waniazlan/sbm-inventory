import { useState } from "react";

import { Plus, Search } from "lucide-react";
import { label, type Movement, type Page, type User } from "../api";

import {
  Button,
  Heading,
  MovementTable,
  Pager,
  Status,
} from "../components/shared";
import { StockForm } from "../components/StockForm";
import { useApp, useLoad } from "../hooks";
export function Movements() {
  const { user } = useApp();
  const [page, setPage] = useState(1),
    [search, setSearch] = useState(""),
    [type, setType] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [actor, setActor] = useState(""),
    [action, setAction] = useState(""),
    [reverse, setReverse] = useState<Movement | null>(null);
  const users = useLoad<User[]>(user.role === "admin" ? "/users" : "/auth/me");
  const q = useLoad<Page<Movement>>(
    `/movements?search=${encodeURIComponent(search)}&type=${type}&from=${from}&to=${to}&actor_id=${actor}&page=${page}`,
  );
  return (
    <>
      <Heading
        title="Movement ledger"
        subtitle="A permanent record of what changed, who recorded it and why."
        actions={
          <Button
            onClick={() =>
              setAction(user.role === "admin" ? "manual_out" : "repair_usage")
            }
          >
            <Plus size={17} />
            Record movement
          </Button>
        }
      />
      <section className="panel">
        <div className="toolbar wrap">
          <div className="search">
            <Search size={18} />
            <input
              aria-label="Search movements"
              placeholder="Search SKU, item or reference"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <select
            aria-label="Movement type"
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All movements</option>
            {[
              "receipt",
              "sale",
              "repair_usage",
              "manual_out",
              "adjustment",
              "return",
              "reversal",
            ].map((t) => (
              <option key={t} value={t}>
                {label(t)}
              </option>
            ))}
          </select>
          <input
            aria-label="From date"
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setPage(1);
            }}
          />
          <input
            aria-label="To date"
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setPage(1);
            }}
          />
          {user.role === "admin" && (
            <select
              aria-label="Recorded by"
              value={actor}
              onChange={(e) => {
                setActor(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All users</option>
              {Array.isArray(users.data) &&
                users.data.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
            </select>
          )}
        </div>
        <Status {...q} retry={q.reload}>
          <MovementTable
            rows={q.data?.data || []}
            onReverse={user.role === "admin" ? setReverse : undefined}
          />
          <Pager page={q.data} setPage={setPage} />
        </Status>
      </section>
      {action && (
        <StockForm kind={action} close={() => setAction("")} done={q.reload} />
      )}{" "}
      {reverse && (
        <StockForm
          kind="reversal"
          movement={reverse}
          close={() => setReverse(null)}
          done={q.reload}
        />
      )}
    </>
  );
}
