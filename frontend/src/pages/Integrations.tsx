import { useState } from "react";

import { Plug, Wrench } from "lucide-react";
import { label, type Page } from "../api";

import { Empty, Heading, Pager, Status, Time } from "../components/shared";
import { useLoad } from "../hooks";
export function Integrations() {
  const [page, setPage] = useState(1);
  const q = useLoad<
    Page<{
      id: number;
      source: string;
      kind: string;
      reference: string;
      response: { reference: string };
      created_at: string;
    }>
  >("/integrations?page=" + page);
  return (
    <>
      <Heading
        title="Integration history"
        subtitle="Trace accepted Sales and Repair events back to your inventory ledger."
      />
      <div className="integration-cards">
        <div className="panel">
          <Plug size={23} />
          <h2>Sales Management</h2>
          <p>
            Receives finalized, paid sales and explicitly accepted returns.
            Every transaction and line carries a stable reference.
          </p>
          <span className="badge green">Authenticated API</span>
        </div>
        <div className="panel">
          <Wrench size={23} />
          <h2>Repair Tracking</h2>
          <p>
            Records actual parts consumed at the time of use, independently of
            invoicing or payment.
          </p>
          <span className="badge green">Duplicate protection</span>
        </div>
      </div>
      <div className="notice">
        This page shows committed inventory events. Rejected requests are
        returned to the sending system for correction; its outbox owns delivery
        retries.
      </div>
      <section className="panel">
        <Status {...q} retry={q.reload}>
          {q.data?.data.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Operation</th>
                    <th>External reference</th>
                    <th>Inventory acknowledgement</th>
                    <th>Received</th>
                  </tr>
                </thead>
                <tbody>
                  {q.data.data.map((e) => (
                    <tr key={e.id}>
                      <td>{label(e.source)}</td>
                      <td>{label(e.kind)}</td>
                      <td>{e.reference}</td>
                      <td>{e.response.reference}</td>
                      <td>
                        <Time value={e.created_at} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              title="No external events yet"
              text="Accepted Sales and Repair requests will appear here."
            />
          )}
          <Pager page={q.data} setPage={setPage} />
        </Status>
      </section>
    </>
  );
}
