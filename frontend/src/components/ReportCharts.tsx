import { useState } from "react";
import { label, money } from "../api";

export type ReportOverview = {
  from: string;
  to: string;
  timezone: string;
  interval: "day" | "week" | "month";
  stock: { items: number; units: number; low_stock: number; value: number };
  supplier_returns: {
    process: { returns: number; quantity: number };
    delivered: { returns: number; quantity: number };
    rejected: { returns: number; quantity: number };
    loss: { quantity: number; value: number };
  };
  activity: { movements: number; stock_in: number; stock_out: number };
  series: { date: string; stock_in: number; stock_out: number }[];
  categories: { name: string; units: number; value: number }[];
  reasons: { type: string; reason: string; quantity: number }[];
};
const number = new Intl.NumberFormat("en-MY");
const percentage = new Intl.NumberFormat("en-MY", {
  style: "percent",
  maximumFractionDigits: 1,
});

export function SupplierReturnPie({
  data,
}: {
  data: ReportOverview["supplier_returns"];
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const rows = [
    {
      status: "process",
      name: "Processing",
      quantity: data.process.quantity,
      colour: "#b58a2d",
    },
    {
      status: "delivered",
      name: "Delivered",
      quantity: data.delivered.quantity,
      colour: "#39775a",
    },
    {
      status: "rejected",
      name: "Rejected",
      quantity: data.rejected.quantity,
      colour: "#bb4f46",
    },
  ];
  const total = rows.reduce((sum, row) => sum + row.quantity, 0);
  const active = total
    ? rows.find((row) => row.status === selected) ||
      rows.find((row) => row.quantity > 0)
    : undefined;
  let angle = -Math.PI / 2;
  const slices = rows
    .filter((row) => row.quantity > 0)
    .map((row) => {
      const start = angle;
      const sweep = (row.quantity / total) * Math.PI * 2;
      angle += sweep;
      const point = (a: number, radius = 100) => [
        120 + radius * Math.cos(a),
        120 + radius * Math.sin(a),
      ];
      const [startX, startY] = point(start);
      const [endX, endY] = point(angle);
      const [labelX, labelY] =
        row.quantity === total ? [120, 120] : point(start + sweep / 2, 64);
      return {
        ...row,
        path: `M 120 120 L ${startX} ${startY} A 100 100 0 ${sweep > Math.PI ? 1 : 0} 1 ${endX} ${endY} Z`,
        labelX,
        labelY,
      };
    });
  const units = (quantity: number) =>
    `${number.format(quantity)} unit${quantity === 1 ? "" : "s"}`;
  const share = (quantity: number) =>
    percentage.format(total ? quantity / total : 0);

  return (
    <div
      className="panel report-return-pie"
      role="group"
      aria-label="Supplier return status pie chart"
    >
      <div className="report-card-heading">
        <div>
          <h3>Return status distribution</h3>
          <p>Share of {units(total)} by current status</p>
        </div>
      </div>
      <div className="report-return-pie-body">
        <svg
          viewBox="0 0 240 240"
          role="img"
          aria-label={rows
            .map(
              (row) =>
                `${row.name}: ${units(row.quantity)}, ${share(row.quantity)}`,
            )
            .join("; ")}
        >
          {!total && <circle cx="120" cy="120" r="100" fill="#edf1ed" />}
          {slices.map((slice) => (
            <g
              key={slice.status}
              className={`report-pie-slice${active?.status === slice.status ? " active" : ""}`}
              onMouseEnter={() => setSelected(slice.status)}
            >
              {slice.quantity === total ? (
                <circle
                  cx="120"
                  cy="120"
                  r="100"
                  fill={slice.colour}
                  data-status={slice.status}
                />
              ) : (
                <path
                  d={slice.path}
                  fill={slice.colour}
                  data-status={slice.status}
                />
              )}
              {slice.quantity / total >= 0.08 && (
                <text
                  x={slice.labelX}
                  y={slice.labelY}
                  fill={slice.status === "process" ? "#203225" : "#fff"}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  aria-hidden="true"
                >
                  {share(slice.quantity)}
                </text>
              )}
            </g>
          ))}
          {!total && (
            <text
              x="120"
              y="120"
              textAnchor="middle"
              dominantBaseline="middle"
              className="report-pie-zero"
            >
              0 units
            </text>
          )}
        </svg>
        <ul className="report-pie-legend" aria-label="Return status breakdown">
          {rows.map((row) => (
            <li key={row.status}>
              <button
                type="button"
                aria-label={`${row.name}: ${units(row.quantity)}, ${share(row.quantity)}`}
                aria-pressed={active?.status === row.status}
                onMouseEnter={() => setSelected(row.status)}
                onFocus={() => setSelected(row.status)}
                onClick={() => setSelected(row.status)}
              >
                <span
                  className="report-pie-key"
                  style={{ background: row.colour }}
                  aria-hidden="true"
                />
                <span>
                  <strong>{row.name}</strong>
                  <small>{units(row.quantity)}</small>
                </span>
                <b>{share(row.quantity)}</b>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <p className="report-pie-selection" role="status">
        {active
          ? `${active.name} · ${units(active.quantity)} · ${share(active.quantity)}`
          : "No supplier returns to chart."}
      </p>
    </div>
  );
}

export function chartDate(date: string) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-MY", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function MovementTrend({ data }: { data: ReportOverview }) {
  const [selected, setSelected] = useState<number | null>(null);
  const series = data.series;
  const maximum = Math.max(
    4,
    Math.ceil(
      series.reduce(
        (max, point) => Math.max(max, point.stock_in, point.stock_out),
        0,
      ) / 4,
    ) * 4,
  );
  const left = 48,
    right = 744,
    top = 18,
    bottom = 190;
  const x = (index: number) =>
    series.length === 1
      ? (left + right) / 2
      : left + (index * (right - left)) / (series.length - 1);
  const y = (value: number) => bottom - (value / maximum) * (bottom - top);
  const line = (key: "stock_in" | "stock_out") =>
    series
      .map(
        (point, index) =>
          `${index === 0 ? "M" : "L"}${x(index)},${y(point[key])}`,
      )
      .join(" ");
  const ticks = [
    ...new Set([
      0,
      Math.floor((series.length - 1) / 4),
      Math.floor((series.length - 1) / 2),
      Math.floor(((series.length - 1) * 3) / 4),
      series.length - 1,
    ]),
  ];
  const active = selected === null ? null : series[selected];
  return (
    <section
      className="panel report-chart report-trend"
      aria-labelledby="movement-trend-title"
    >
      <div className="report-card-heading">
        <div>
          <span className="report-eyebrow">STOCK ACTIVITY</span>
          <h2 id="movement-trend-title">Stock in &amp; out</h2>
          <p>
            {data.interval === "day"
              ? "Daily"
              : data.interval === "week"
                ? "Weekly"
                : "Monthly"}{" "}
            quantities · {number.format(data.activity.movements)} movements
          </p>
        </div>
        <div className="report-chart-totals">
          <span>
            <i className="report-dot in" />
            In <strong>{number.format(data.activity.stock_in)}</strong>
          </span>
          <span>
            <i className="report-dot out" />
            Out <strong>{number.format(data.activity.stock_out)}</strong>
          </span>
        </div>
      </div>
      <div className="report-trend-selection" aria-live="polite">
        {active ? (
          <>
            <strong>{chartDate(active.date)}</strong>
            <span>
              {number.format(active.stock_in)} in ·{" "}
              {number.format(active.stock_out)} out
            </span>
          </>
        ) : (
          <span>
            {data.activity.movements
              ? "Hover, tap or focus a date to see its quantities."
              : "No stock movements in this period."}
          </span>
        )}
      </div>
      <svg
        viewBox="0 0 768 230"
        className="report-trend-svg"
        role="group"
        aria-label="Stock movements chart"
      >
        {[0, 1, 2, 3, 4].map((tick) => (
          <g key={tick}>
            <line
              x1={left}
              x2={right}
              y1={y((maximum * tick) / 4)}
              y2={y((maximum * tick) / 4)}
              className="report-grid-line"
            />
            <text
              x={left - 10}
              y={y((maximum * tick) / 4) + 4}
              textAnchor="end"
              className="report-axis-text"
            >
              {new Intl.NumberFormat("en-MY", { notation: "compact" }).format(
                (maximum * tick) / 4,
              )}
            </text>
          </g>
        ))}
        {series.length > 1 && (
          <path
            d={`${line("stock_in")} L${right},${bottom} L${left},${bottom} Z`}
            className="report-area-in"
          />
        )}
        <path d={line("stock_in")} className="report-line-in" />
        <path d={line("stock_out")} className="report-line-out" />
        {selected !== null && (
          <line
            x1={x(selected)}
            x2={x(selected)}
            y1={top}
            y2={bottom}
            className="report-selected-line"
          />
        )}
        {series.map((point, index) => (
          <g key={point.date}>
            {(selected === index || series.length === 1) && (
              <>
                <circle
                  cx={x(index)}
                  cy={y(point.stock_in)}
                  r="4"
                  className="report-point-in"
                />
                <circle
                  cx={x(index)}
                  cy={y(point.stock_out)}
                  r="4"
                  className="report-point-out"
                />
              </>
            )}
            <rect
              x={Math.max(
                left,
                x(index) - (right - left) / Math.max(1, series.length - 1) / 2,
              )}
              y={top}
              width={
                Math.min(
                  right,
                  x(index) +
                    (right - left) / Math.max(1, series.length - 1) / 2,
                ) -
                Math.max(
                  left,
                  x(index) -
                    (right - left) / Math.max(1, series.length - 1) / 2,
                )
              }
              height={bottom - top}
              fill="transparent"
              tabIndex={0}
              role="button"
              className="report-chart-target"
              aria-label={`${chartDate(point.date)}: ${point.stock_in} stock in, ${point.stock_out} stock out`}
              onMouseEnter={() => setSelected(index)}
              onFocus={() => setSelected(index)}
              onClick={() => setSelected(index)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setSelected(index);
                }
              }}
            />
          </g>
        ))}
        {ticks.map((index) => (
          <text
            key={index}
            x={x(index)}
            y="219"
            textAnchor={
              index === 0
                ? "start"
                : index === series.length - 1
                  ? "end"
                  : "middle"
            }
            className="report-axis-text"
          >
            {new Date(`${series[index].date}T12:00:00Z`).toLocaleDateString(
              "en-MY",
              { day: "numeric", month: "short", timeZone: "UTC" },
            )}
          </text>
        ))}
      </svg>
    </section>
  );
}

export function CategoryValue({
  categories,
}: {
  categories: ReportOverview["categories"];
}) {
  const rows =
    categories.length > 6
      ? [
          ...categories.slice(0, 5),
          {
            name: "Other categories",
            units: categories.slice(5).reduce((sum, row) => sum + row.units, 0),
            value: categories.slice(5).reduce((sum, row) => sum + row.value, 0),
          },
        ]
      : categories;
  const maximum = Math.max(...rows.map((row) => row.value), 1);
  return (
    <section
      className="panel report-chart"
      aria-labelledby="category-value-title"
    >
      <div className="report-card-heading">
        <div>
          <span className="report-eyebrow">CURRENT SNAPSHOT</span>
          <h2 id="category-value-title">Value by category</h2>
          <p>Remaining stock at its original batch cost</p>
        </div>
      </div>
      {rows.length ? (
        <ul className="report-bars" aria-label="Stock value by category">
          {rows.map((row, index) => (
            <li key={row.name}>
              <div className="report-bar-caption">
                <span>
                  <strong>{row.name}</strong>
                  <small>{number.format(row.units)} units</small>
                </span>
                <b>{money(row.value)}</b>
              </div>
              <div className="report-bar-track">
                <span
                  className={`report-bar-fill shade-${index % 3}`}
                  style={{ width: `${(row.value / maximum) * 100}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="report-chart-empty">
          Add stock to see category values here.
        </p>
      )}
    </section>
  );
}

export function OutReasonChart({
  reasons,
}: {
  reasons: ReportOverview["reasons"];
}) {
  const maximum = Math.max(...reasons.map((row) => row.quantity), 1);
  return reasons.length ? (
    <div className="report-reasons-chart">
      <p className="report-chart-caption">Top reasons by units leaving stock</p>
      <ul className="report-bars" aria-label="Stock-out reasons chart">
        {reasons.map((row) => (
          <li key={`${row.type}-${row.reason}`}>
            <div className="report-bar-caption">
              <span>
                <strong>{row.reason}</strong>
                <small>{label(row.type)}</small>
              </span>
              <b>{number.format(row.quantity)} units</b>
            </div>
            <div className="report-bar-track">
              <span
                className="report-bar-fill out"
                style={{ width: `${(row.quantity / maximum) * 100}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  ) : null;
}
