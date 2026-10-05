import { useCallback, useEffect, useState } from "react";

import axios from "axios";
import {
  ArrowLeftRight,
  ArrowRight,
  BarChart3,
  Check,
  ChevronRight,
  Layers,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  Plug,
  Settings,
  ShieldCheck,
  TriangleAlert,
  Wrench,
  X,
} from "lucide-react";
import {
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { api, csrf, errorText, label, type Metadata, type User } from "./api";

import { Button, ErrorBox, Field, Status } from "./components/shared";
import { Context, useLoad } from "./hooks";
import { Catalogue } from "./pages/Catalogue";
import { Integrations } from "./pages/Integrations";
import { Movements } from "./pages/Movements";
import { Overview } from "./pages/Overview";
import { Repairs } from "./pages/Repairs";
import { Reports } from "./pages/Reports";
import { SettingsPage } from "./pages/SettingsPage";
export function Login({ done }: { done: (u: User) => void }) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div className="login">
      <section className="login-art">
        <div className="brand">
          sbm<span>.</span>
          <small>INVENTORY</small>
        </div>
        <div>
          <span className="eyebrow">SMART BUSINESS MANAGER</span>
          <h1>
            The right part.
            <br />
            Ready when
            <br />
            you need it.
          </h1>
          <p>Keep your stock accurate and your workshop moving.</p>
          <div className="part-art">
            <div>
              <Package size={54} />
              <span>Parts, in order.</span>
            </div>
            <div>
              <Layers size={35} />
              <span>Every unit accounted for.</span>
            </div>
          </div>
        </div>
        <small>Built for the way your shop works.</small>
      </section>
      <section className="login-form">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            setBusy(true);
            setError("");
            try {
              await csrf();
              const r = await api.post<User>("/auth/login", {
                email: f.get("email"),
                password: f.get("password"),
              });
              done(r.data);
            } catch (e) {
              setError(errorText(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          <span className="eyebrow">YOUR INVENTORY WORKSPACE</span>
          <h1>Welcome back</h1>
          <p>Sign in to manage your parts and stock.</p>
          <ErrorBox message={error} />
          <Field label="Email address">
            <input
              name="email"
              type="email"
              required
              autoComplete="username"
              placeholder="you@yourshop.com"
            />
          </Field>
          <Field label="Password">
            <input
              name="password"
              type="password"
              required
              autoComplete="current-password"
              placeholder="Enter your password"
            />
          </Field>
          <Button disabled={busy}>
            {busy ? "Signing in…" : "Sign in to Inventory"}
            <ArrowRight size={18} />
          </Button>
          <div className="login-help">
            <ShieldCheck size={20} />
            <span>
              Access for authorised shop staff.
              <br />
              Contact your administrator for an account.
            </span>
          </div>
        </form>
      </section>
    </div>
  );
}
export function Shell({
  user,
  logout,
}: {
  user: User;
  logout: () => Promise<void>;
}) {
  const metadata = useLoad<Metadata>("/metadata");
  const [toast, setToast] = useState(""),
    [mobile, setMobile] = useState(false);
  const location = useLocation();
  useEffect(() => {
    setMobile(false);
  }, [location.pathname]);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(""), 5000);
      return () => clearTimeout(t);
    }
  }, [toast]);
  const links = [
    { to: "/", name: "Overview", icon: LayoutDashboard },
    { to: "/catalogue", name: "Item catalogue", icon: Package },
    { to: "/movements", name: "Movement ledger", icon: ArrowLeftRight },
    { to: "/repairs", name: "Repair parts", icon: Wrench },
    { to: "/low-stock", name: "Low-stock watch", icon: TriangleAlert },
    { to: "/reports", name: "Reports", icon: BarChart3, admin: true },
    { to: "/integrations", name: "Integrations", icon: Plug, admin: true },
    { to: "/settings", name: "Settings", icon: Settings, admin: true },
  ];
  return (
    <div className="app-shell">
      <aside className={mobile ? "open" : ""}>
        <div className="brand">
          sbm<span>.</span>
          <small>INVENTORY</small>
        </div>
        <div className="workspace">
          <div>
            <Package size={19} />
          </div>
          <span>
            Inventory workspace<small>Parts & accessories</small>
          </span>
        </div>
        <span className="nav-label">WORKSPACE</span>
        <nav>
          {links
            .filter((l) => !l.admin || user.role === "admin")
            .map((l) => (
              <NavLink end to={l.to} key={l.to}>
                <l.icon size={19} />
                {l.name}
              </NavLink>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="ledger-note">
            <ShieldCheck size={18} />
            <span>
              Stock you can trace.<small>Every movement stays on record.</small>
            </span>
          </div>
          <div className="profile">
            <span className="avatar">{user.name.slice(0, 1)}</span>
            <div>
              <strong>{user.name}</strong>
              <small>{label(user.role)}</small>
            </div>
            <button
              className="icon-button"
              title="Sign out"
              aria-label="Sign out"
              onClick={() => logout().catch((e) => setToast(errorText(e)))}
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </aside>
      {mobile && (
        <button
          className="scrim"
          aria-label="Close menu"
          onClick={() => setMobile(false)}
        />
      )}
      <div className="main-shell">
        <header>
          <div>
            <button
              className="icon-button mobile-toggle"
              onClick={() => setMobile(!mobile)}
              aria-label="Open menu"
            >
              <Menu size={22} />
            </button>
            <span className="breadcrumb">
              Workspace <ChevronRight size={13} />
              <b>
                {links.find((l) => l.to === location.pathname)?.name ||
                  "Inventory"}
              </b>
            </span>
          </div>
          <div>
            <span className="header-status">
              <span />
              Inventory ledger
            </span>
            <span className="avatar small-avatar">{user.name.slice(0, 1)}</span>
          </div>
        </header>
        <main>
          <Status {...metadata} retry={metadata.reload}>
            {metadata.data && (
              <Context.Provider
                value={{
                  user,
                  meta: metadata.data,
                  reload: metadata.reload,
                  notify: setToast,
                }}
              >
                <Routes>
                  <Route path="/" element={<Overview />} />
                  <Route path="/catalogue" element={<Catalogue key="all" />} />
                  <Route
                    path="/low-stock"
                    element={<Catalogue low key="low" />}
                  />
                  <Route path="/movements" element={<Movements />} />
                  <Route path="/repairs" element={<Repairs />} />
                  {user.role === "admin" && (
                    <>
                      <Route path="/reports" element={<Reports />} />
                      <Route path="/settings" element={<SettingsPage />} />
                      <Route path="/integrations" element={<Integrations />} />
                    </>
                  )}
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </Context.Provider>
            )}
          </Status>
        </main>
        <footer>
          Smart Business Manager{" "}
          <span>
            Inventory · {metadata.data?.timezone || "Asia/Kuala_Lumpur"}
          </span>
        </footer>
      </div>
      {toast && (
        <div className="toast" role="status">
          <Check size={18} />
          {toast}
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
export function App() {
  const [user, setUser] = useState<User | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const load = useCallback(() => {
    setLoading(true);
    setError("");
    api
      .get<User>("/auth/me")
      .then((r) => setUser(r.data))
      .catch((e) => {
        if (!axios.isAxiosError(e) || e.response?.status !== 401)
          setError(errorText(e));
      })
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    const i = api.interceptors.response.use(
      (r) => r,
      (e) => {
        if (
          [401, 419].includes(e.response?.status) &&
          !e.config?.url?.includes("/auth/login")
        )
          setUser(null);
        return Promise.reject(e);
      },
    );
    return () => api.interceptors.response.eject(i);
  }, []);
  if (loading) return <div className="loading full">Opening Inventory…</div>;
  if (error)
    return (
      <div className="full">
        <ErrorBox message={error} />
        <Button onClick={load}>Reconnect</Button>
      </div>
    );
  return user ? (
    <Shell
      user={user}
      logout={async () => {
        await api.post("/auth/logout");
        setUser(null);
      }}
    />
  ) : (
    <Login done={setUser} />
  );
}
