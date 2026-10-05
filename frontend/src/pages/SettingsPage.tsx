import React, { useState } from "react";

import { Package, Plus } from "lucide-react";
import {
  api,
  errorText,
  label,
  type Named,
  type Page,
  type User,
} from "../api";

import {
  Button,
  Empty,
  ErrorBox,
  Field,
  Heading,
  Modal,
  Pager,
  Status,
  Time,
} from "../components/shared";
import { useApp, useLoad } from "../hooks";
export function SettingsPage() {
  const { meta, reload, notify } = useApp();
  const [tab, setTab] = useState("categories"),
    [modal, setModal] = useState(false),
    [edit, setEdit] = useState<User | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const users = useLoad<User[]>("/users");
  const [auditPage, setAuditPage] = useState(1);
  const audits = useLoad<
    Page<{
      id: number;
      action: string;
      target: string;
      source: string;
      actor_id: number | null;
      created_at: string;
      details: object;
    }>
  >("/audit?page=" + auditPage);
  const lists: Record<string, Named[]> = {
    categories: meta.categories,
    "phone-models": meta.phone_models,
    suppliers: meta.suppliers,
  };
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    let d: Record<string, unknown> = { name: f.get("name") };
    if (tab === "phone-models") d.brand = f.get("brand");
    if (tab === "suppliers") d.contact = f.get("contact");
    if (tab === "users")
      d = {
        ...d,
        email: f.get("email"),
        role: f.get("role"),
        active: f.get("active") === "on",
        password: f.get("password") || null,
      };
    setBusy(true);
    setError("");
    try {
      await api.request({
        method: tab === "users" && edit ? "PUT" : "POST",
        url:
          tab === "users"
            ? "/users" + (edit ? "/" + edit.id : "")
            : "/metadata/" + tab,
        data: d,
      });
      reload();
      users.reload();
      audits.reload();
      setModal(false);
      setEdit(null);
      notify("Saved successfully.");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Heading
        title="Workspace settings"
        subtitle="Manage catalogue references, staff access and audit history."
        actions={
          tab !== "audit" && (
            <Button
              onClick={() => {
                setEdit(null);
                setError("");
                setModal(true);
              }}
            >
              <Plus size={17} />
              Add{" "}
              {tab === "users"
                ? "staff"
                : tab === "phone-models"
                  ? "phone model"
                  : tab === "suppliers"
                    ? "supplier"
                    : "category"}
            </Button>
          )
        }
      />
      <div className="report-tabs">
        {Object.entries({
          categories: "Categories",
          "phone-models": "Phone models",
          suppliers: "Suppliers",
          users: "Staff access",
          audit: "Audit trail",
        }).map(([k, v]) => (
          <button
            key={k}
            className={tab === k ? "selected" : ""}
            onClick={() => setTab(k)}
          >
            {v}
          </button>
        ))}
      </div>
      <section className="panel">
        {lists[tab] ? (
          <div className="reference-grid">
            {lists[tab].map((x) => (
              <div key={x.id}>
                <Package size={20} />
                <div>
                  <strong>
                    {"brand" in x ? String(x.brand) + " " : ""}
                    {x.name}
                  </strong>
                  <small>
                    {"contact" in x
                      ? String(x.contact || "")
                      : tab === "phone-models"
                        ? "Phone compatibility reference"
                        : "Catalogue reference"}
                  </small>
                </div>
              </div>
            ))}
            {!lists[tab].length && <Empty />}
          </div>
        ) : tab === "users" ? (
          <Status {...users} retry={users.reload}>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {users.data?.map((u) => (
                    <tr key={u.id}>
                      <td>{u.name}</td>
                      <td>{u.email}</td>
                      <td>{label(u.role)}</td>
                      <td>{u.active ? "Active" : "Disabled"}</td>
                      <td>
                        <Button
                          variant="quiet"
                          onClick={() => {
                            setEdit(u);
                            setModal(true);
                            setError("");
                          }}
                        >
                          Edit
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Status>
        ) : (
          <Status {...audits} retry={audits.reload}>
            <div className="audit-list">
              {audits.data?.data.map((a) => (
                <details key={a.id}>
                  <summary>
                    <strong>{a.action}</strong>
                    <span>
                      {a.source} · Record {a.target} ·{" "}
                      {a.actor_id ? "User #" + a.actor_id : "Integration"} ·{" "}
                      <Time value={a.created_at} />
                    </span>
                  </summary>
                  <pre>{JSON.stringify(a.details, null, 2)}</pre>
                </details>
              ))}
            </div>
            <Pager page={audits.data} setPage={setAuditPage} />
          </Status>
        )}
      </section>
      {modal && (
        <Modal
          title={
            edit
              ? "Edit staff account"
              : "Add " +
                (tab === "phone-models"
                  ? "phone model"
                  : tab === "users"
                    ? "staff"
                    : tab.slice(0, -1))
          }
          close={() => {
            if (!busy) setModal(false);
          }}
        >
          <form onSubmit={submit}>
            <ErrorBox message={error} />
            <fieldset disabled={busy} className="form-grid">
              {tab === "phone-models" && (
                <Field label="Phone brand" wide>
                  <input
                    name="brand"
                    required
                    maxLength={100}
                    placeholder="Apple, Samsung…"
                  />
                </Field>
              )}
              <Field label="Name" wide>
                <input
                  name="name"
                  required
                  maxLength={150}
                  defaultValue={edit?.name}
                />
              </Field>
              {tab === "suppliers" && (
                <Field label="Contact" wide>
                  <input name="contact" maxLength={200} />
                </Field>
              )}
              {tab === "users" && (
                <>
                  <Field label="Email" wide>
                    <input
                      type="email"
                      name="email"
                      required
                      defaultValue={edit?.email}
                    />
                  </Field>
                  <Field
                    label={
                      edit ? "New password (leave blank to retain)" : "Password"
                    }
                    wide
                  >
                    <input
                      type="password"
                      name="password"
                      required={!edit}
                      minLength={12}
                      maxLength={200}
                      autoComplete="new-password"
                    />
                  </Field>
                  <Field label="Role">
                    <select
                      name="role"
                      defaultValue={edit?.role || "technician"}
                    >
                      <option value="technician">Technician</option>
                      <option value="admin">Administrator</option>
                    </select>
                  </Field>
                  <label className="check">
                    <input
                      name="active"
                      type="checkbox"
                      defaultChecked={edit?.active ?? true}
                    />
                    Active account
                  </label>
                </>
              )}
            </fieldset>
            <div className="modal-footer">
              <Button disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
