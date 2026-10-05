import { useState } from "react";

import { Download } from "lucide-react";
import { api, errorText, type Page } from "../api";

import {
  Button,
  Empty,
  ErrorBox,
  Field,
  Heading,
  Pager,
  Status,
} from "../components/shared";
import { useApp, useLoad } from "../hooks";
export function Reports() {
  const { meta } = useApp();
  const [kind, setKind] = useState("current"),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [page, setPage] = useState(1),
    [error, setError] = useState("");
  const params = `kind=${kind}&from=${from}&to=${to}`;
  const q = useLoad<Page<Record<string, string | number | null>>>(
    "/reports?" + params + "&page=" + page,
  );
  async function download() {
    try {
      const r = await api.get("/reports?" + params + "&format=csv", {
        responseType: "blob",
      });
      const url = URL.createObjectURL(r.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `inventory-${kind}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(errorText(e));
    }
  }
  return (
    <>
      <Heading
        title="Inventory reports"
        subtitle="Review availability, understand usage and reconcile stock."
        actions={
          <Button onClick={download}>
            <Download size={17} />
            Export CSV
          </Button>
        }
      />
      <div className="report-tabs">
        {Object.entries({
          current: "Current stock",
          low: "Low stock",
          movements: "Movements",
          reasons: "Stock-out reasons",
          repairs: "Repair usage",
          sales: "Sales linkage",
          valuation: "Valuation",
        }).map(([k, v]) => (
          <button
            className={kind === k ? "selected" : ""}
            key={k}
            onClick={() => {
              setKind(k);
              setPage(1);
            }}
          >
            {v}
          </button>
        ))}
      </div>
      <p className="muted">
        {["current", "low", "valuation"].includes(kind)
          ? meta.valuation_method
          : `Dates are displayed in ${meta.timezone}.`}
      </p>
      <ErrorBox message={error} />
      <section className="panel">
        {!["current", "low", "valuation"].includes(kind) && (
          <div className="toolbar">
            <Field label="From">
              <input
                type="date"
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value);
                  setPage(1);
                }}
              />
            </Field>
            <Field label="To">
              <input
                type="date"
                value={to}
                onChange={(e) => {
                  setTo(e.target.value);
                  setPage(1);
                }}
              />
            </Field>
          </div>
        )}
        <Status {...q} retry={q.reload}>
          {q.data?.data.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    {Object.keys(q.data.data[0]).map((k) => (
                      <th key={k}>{k}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {q.data.data.map((r, i) => (
                    <tr key={i}>
                      {Object.values(r).map((v, n) => (
                        <td key={n}>{v ?? "—"}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="No report data" />
          )}
          <Pager page={q.data} setPage={setPage} />
        </Status>
      </section>
    </>
  );
}
