import React, { useState } from "react";

import { Wrench } from "lucide-react";
import { api, errorText, type Job, type Page, type User } from "../api";

import {
  Button,
  Empty,
  ErrorBox,
  Field,
  Heading,
  Modal,
  Pager,
  Status,
} from "../components/shared";
import { StockForm } from "../components/StockForm";
import { useApp, useLoad } from "../hooks";
export function Repairs() {
  const { user, notify } = useApp();
  const [page, setPage] = useState(1),
    [modal, setModal] = useState(false),
    [usePart, setUsePart] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const q = useLoad<Page<Job>>("/repair-jobs?page=" + page);
  const users = useLoad<User[]>(user.role === "admin" ? "/users" : "/auth/me");
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      await api.post("/repair-jobs", {
        reference: f.get("reference"),
        technician_id: Number(f.get("technician_id")),
        active: f.get("active") === "on",
      });
      setModal(false);
      q.reload();
      notify("Repair assignment saved.");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Heading
        title="Repair parts"
        subtitle="Issue parts when they are physically used, independently of payment."
        actions={
          <>
            {user.role === "admin" && (
              <Button variant="secondary" onClick={() => setModal(true)}>
                Assign repair
              </Button>
            )}
            <Button onClick={() => setUsePart(true)}>
              <Wrench size={17} />
              Record usage
            </Button>
          </>
        }
      />
      <div className="notice">
        Repair references establish who may consume parts. Diagnosis, repair
        progress and customer billing remain in their respective systems.
      </div>
      <section className="panel">
        <Status {...q} retry={q.reload}>
          {q.data?.data.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Repair reference</th>
                    <th>Assigned technician</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {q.data.data.map((j) => (
                    <tr key={j.id}>
                      <td>
                        <strong>{j.reference}</strong>
                      </td>
                      <td>{j.technician.name}</td>
                      <td>
                        <span
                          className={
                            "badge " + (j.active ? "green" : "neutral")
                          }
                        >
                          {j.active ? "Open for parts" : "Closed"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              title="No repair assignments"
              text="An administrator can assign a repair reference to a technician."
            />
          )}
          <Pager page={q.data} setPage={setPage} />
        </Status>
      </section>
      {modal && (
        <Modal
          title="Assign a repair"
          subtitle="Use the exact external repair reference. Saving an existing reference updates its assignment."
          close={() => setModal(false)}
        >
          <form onSubmit={submit}>
            <ErrorBox message={error} />
            <fieldset disabled={busy} className="form-grid">
              <Field label="Repair reference" wide>
                <input name="reference" required maxLength={120} />
              </Field>
              <Field label="Technician" wide>
                <select name="technician_id" required>
                  <option value="">Select technician</option>
                  {Array.isArray(users.data) &&
                    users.data
                      .filter((u) => u.active && u.role === "technician")
                      .map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                </select>
              </Field>
              <label className="check wide">
                <input type="checkbox" name="active" defaultChecked />
                Open for parts usage
              </label>
            </fieldset>
            <div className="modal-footer">
              <Button disabled={busy}>Save assignment</Button>
            </div>
          </form>
        </Modal>
      )}
      {usePart && (
        <StockForm
          kind="repair_usage"
          close={() => setUsePart(false)}
          done={q.reload}
        />
      )}
    </>
  );
}
