import { useState, type ReactNode } from "react";
import { Download, Layers, Package, TriangleAlert, Wallet } from "lucide-react";
import { api, errorText, label, money, type Page } from "../api";
import {
  Button,
  Empty,
  ErrorBox,
  Field,
  Heading,
  Pager,
  Status,
} from "../components/shared";
import {
  CategoryValue,
  MovementTrend,
  OutReasonChart,
  type ReportOverview,
} from "../components/ReportCharts";
import { useApp, useLoad } from "../hooks";
import "./reports.css";

type Range = { from: string; to: string };
type ReportRow = Record<string, string | number | null>;
const reports = {
  current: {
    title: "Stock & valuation",
    description: "Current quantities and remaining stock value",
    columns: ["SKU", "Name", "Category", "Stock", "Minimum", "Value (sen)"],
  },
  low: {
    title: "Low stock",
    description: "Active items at or below their minimum level",
    columns: ["SKU", "Name", "Stock", "Minimum", "Value (sen)"],
  },
  movements: {
    title: "Stock movements",
    description:
      "Receipts, issues, returns and reversals in the selected period",
    columns: [
      "Occurred at",
      "SKU",
      "Type",
      "Change",
      "Total cost (sen)",
      "Reason",
      "Reference",
      "Actor",
    ],
  },
  reasons: {
    title: "Stock-out reasons",
    description: "Why units left stock during the selected period",
    columns: ["Reason", "Type", "Quantity"],
  },
  repairs: {
    title: "Repair usage",
    description: "Parts usage recorded through SBM Tracking",
    columns: [
      "Occurred at",
      "SKU",
      "Repair job",
      "Change",
      "Total cost (sen)",
      "Reason",
    ],
  },
  sales: {
    title: "Sales linkage",
    description: "Stock activity linked to sales in the selected period",
    columns: ["Occurred at", "SKU", "Reference", "Change", "Total cost (sen)"],
  },
};
type Kind = keyof typeof reports;
type ExportKind = Kind | "valuation";
const isSnapshot = (kind: ExportKind) =>
  ["current", "low", "valuation"].includes(kind);
const params = (kind: ExportKind, range: Range) =>
  new URLSearchParams({ kind, ...(isSnapshot(kind) ? {} : range) }).toString();
const number = new Intl.NumberFormat("en-MY");

function defaultRange(timezone: string): Range {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) =>
    parts.find((part) => part.type === type)!.value;
  const to = `${part("year")}-${part("month")}-${part("day")}`;
  const start = new Date(`${to}T12:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 29);
  return { from: start.toISOString().slice(0, 10), to };
}

function ReportSection({
  kind,
  range,
  download,
  exporting,
  chart,
}: {
  kind: Kind;
  range: Range;
  download: (kind: ExportKind) => void;
  exporting: boolean;
  chart?: ReactNode;
}) {
  const [page, setPage] = useState(1);
  const { meta } = useApp();
  const query = useLoad<Page<ReportRow>>(
    `/reports?${params(kind, range)}&page=${page}&per_page=5`,
  );
  const report = reports[kind];
  function cell(key: string, value: ReportRow[string]) {
    if (value === null) return "—";
    if (key.endsWith("(sen)")) return money(Number(value));
    if (key === "Occurred at")
      return new Intl.DateTimeFormat("en-MY", {
        timeZone: meta.timezone,
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(String(value)));
    if (key === "Type") return label(String(value));
    return typeof value === "number" ? number.format(value) : value;
  }
  const body = (
    <Status {...query} retry={query.reload}>
      {query.data?.data.length ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {report.columns.map((key) => (
                  <th
                    key={key}
                    scope="col"
                    className={
                      [
                        "Stock",
                        "Minimum",
                        "Quantity",
                        "Change",
                        "Value (sen)",
                        "Total cost (sen)",
                      ].includes(key)
                        ? "report-number"
                        : undefined
                    }
                  >
                    {key === "Value (sen)"
                      ? "Stock value"
                      : key.replace(" (sen)", "")}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {query.data.data.map((row, index) => (
                <tr key={`${row.ID ?? row.SKU ?? row.Reason}-${index}`}>
                  {report.columns.map((key) => (
                    <td
                      key={key}
                      className={
                        typeof row[key] === "number"
                          ? "report-number"
                          : undefined
                      }
                    >
                      {cell(key, row[key] ?? null)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty
          title={
            kind === "low"
              ? "No low-stock items"
              : isSnapshot(kind)
                ? "No items to report"
                : "No activity in this period"
          }
          text={
            kind === "low"
              ? "No active items are at or below their minimum stock."
              : "Matching records will appear here."
          }
        />
      )}
      <Pager page={query.data} setPage={setPage} />
    </Status>
  );
  return (
    <section
      className="panel report-detail"
      aria-labelledby={`report-${kind}-title`}
    >
      <div className="report-card-heading">
        <div>
          <h2 id={`report-${kind}-title`}>{report.title}</h2>
          <p>{report.description}</p>
        </div>
        <Button
          variant="quiet"
          disabled={exporting}
          onClick={() => download(kind)}
          aria-label={`Export ${report.title} CSV`}
        >
          <Download size={15} />
          CSV
        </Button>
      </div>
      {chart ? (
        <div className="report-reason-layout">
          {chart}
          <div>{body}</div>
        </div>
      ) : (
        body
      )}
    </section>
  );
}

export function Reports() {
  const { meta } = useApp();
  const timezone = meta.timezone || "Asia/Kuala_Lumpur";
  const [range, setRange] = useState(() => defaultRange(timezone));
  const [draft, setDraft] = useState(range);
  const [exportKind, setExportKind] = useState<ExportKind>("current");
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  const overview = useLoad<ReportOverview>(
    `/reports/overview?${new URLSearchParams(range)}`,
  );

  async function download(kind: ExportKind) {
    if (exporting) return;
    setError("");
    setExporting(true);
    try {
      const response = await api.get(
        `/reports?${params(kind, range)}&format=csv`,
        { responseType: "blob" },
      );
      const url = URL.createObjectURL(response.data);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `inventory-${kind}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setError(errorText(error));
    } finally {
      setExporting(false);
    }
  }
  const section = (kind: Kind, chart?: ReactNode) => (
    <ReportSection
      key={`${kind}-${isSnapshot(kind) ? "current" : range.from + range.to}`}
      kind={kind}
      range={range}
      download={(kind) => void download(kind)}
      exporting={exporting}
      chart={chart}
    />
  );

  return (
    <div className="inventory-reports">
      <Heading
        title="Inventory reports"
        subtitle="Stock, value and activity. One complete view."
        actions={
          <div className="report-export">
            <select
              aria-label="Export report"
              value={exportKind}
              onChange={(event) =>
                setExportKind(event.target.value as ExportKind)
              }
            >
              {Object.entries(reports).map(([kind, report]) => (
                <option key={kind} value={kind}>
                  {report.title}
                </option>
              ))}
              <option value="valuation">Valuation</option>
            </select>
            <Button
              onClick={() => void download(exportKind)}
              disabled={exporting}
            >
              <Download size={17} />
              {exporting ? "Exporting…" : "Export CSV"}
            </Button>
          </div>
        }
      />
      <form
        className="panel report-filters"
        aria-label="Report date range"
        onSubmit={(event) => {
          event.preventDefault();
          if (draft.from > draft.to) {
            setError("The start date must be on or before the end date.");
            return;
          }
          setError("");
          setRange({ ...draft });
        }}
      >
        <div className="report-filter-intro">
          <strong>Activity period</strong>
          <span>Stock balances show the current snapshot.</span>
        </div>
        <Field label="From">
          <input
            type="date"
            required
            value={draft.from}
            onChange={(event) =>
              setDraft({ ...draft, from: event.target.value })
            }
          />
        </Field>
        <Field label="To">
          <input
            type="date"
            required
            min={draft.from}
            value={draft.to}
            onChange={(event) => setDraft({ ...draft, to: event.target.value })}
          />
        </Field>
        <Button type="submit" variant="secondary">
          Apply dates
        </Button>
        <Button
          type="button"
          variant="quiet"
          onClick={() => {
            const next = defaultRange(timezone);
            setDraft(next);
            setRange(next);
            setError("");
          }}
        >
          Last 30 days
        </Button>
      </form>
      <ErrorBox message={error} />
      <Status {...overview} retry={overview.reload}>
        {overview.data && (
          <>
            <div className="report-metrics">
              {[
                {
                  title: "Stock value",
                  value: money(overview.data.stock.value),
                  note: "Original batch costs",
                  icon: Wallet,
                },
                {
                  title: "Units on hand",
                  value: number.format(overview.data.stock.units),
                  note: "Across your catalogue",
                  icon: Layers,
                },
                {
                  title: "Catalogue items",
                  value: number.format(overview.data.stock.items),
                  note: "Current items, including inactive",
                  icon: Package,
                },
                {
                  title: "Low-stock items",
                  value: number.format(overview.data.stock.low_stock),
                  note: "Includes out-of-stock items",
                  icon: TriangleAlert,
                  warn: true,
                },
              ].map((metric) => (
                <section
                  className={`panel report-metric${metric.warn ? " warn" : ""}`}
                  aria-label={metric.title}
                  key={metric.title}
                >
                  <div>
                    <span>{metric.title}</span>
                    <metric.icon size={18} />
                  </div>
                  <strong>{metric.value}</strong>
                  <small>{metric.note}</small>
                </section>
              ))}
            </div>
            <div className="report-charts-grid">
              <MovementTrend key={range.from + range.to} data={overview.data} />
              <CategoryValue categories={overview.data.categories} />
            </div>
          </>
        )}
      </Status>
      {section("current")}
      {section("low")}
      {section(
        "reasons",
        overview.data && !overview.loading && !overview.error ? (
          <OutReasonChart reasons={overview.data.reasons} />
        ) : undefined,
      )}
      {section("movements")}
      <div className="report-details-grid">
        {section("repairs")}
        {section("sales")}
      </div>
      <p className="report-timezone">
        Activity dates follow {timezone}. Stock in includes receipts, returns
        and positive adjustments or reversals; stock out includes all stock
        reductions.
      </p>
    </div>
  );
}
