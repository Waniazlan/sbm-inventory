import { useCallback, useEffect, useRef, useState } from "react";

import axios from "axios";
import {
  ArrowLeftRight,
  BarChart3,
  Check,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  Plug,
  Settings,
  TriangleAlert,
  Wrench,
  X,
} from "lucide-react";
import {
  Navigate,
  Link,
  NavLink,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { api, errorText, label, type Metadata, type User } from "./api";

import { Button, ErrorBox, Status } from "./components/shared";
import { Context, useLoad } from "./hooks";
import { Login } from "./pages/Login";
import { Catalogue } from "./pages/Catalogue";
import { Integrations } from "./pages/Integrations";
import { Movements } from "./pages/Movements";
import { Overview } from "./pages/Overview";
import { Repairs } from "./pages/Repairs";
import { Reports } from "./pages/Reports";
import { SettingsPage } from "./pages/SettingsPage";
export { Login } from "./pages/Login";
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
  const menuRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  useEffect(() => {
    setMobile(false);
  }, [location.pathname]);
  useEffect(() => {
    if (!mobile) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    sidebarRef.current?.querySelector<HTMLElement>("a")?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobile(false);
        menuRef.current?.focus();
      }
      if (event.key === "Tab") {
        const targets =
          sidebarRef.current?.querySelectorAll<HTMLElement>("a, button");
        if (!targets?.length) return;
        const first = targets[0],
          last = targets[targets.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", keydown);
    const desktop = window.matchMedia("(min-width: 951px)");
    const closeOnDesktop = () => {
      if (desktop.matches) setMobile(false);
    };
    desktop.addEventListener("change", closeOnDesktop);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", keydown);
      desktop.removeEventListener("change", closeOnDesktop);
    };
  }, [mobile]);
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
      <aside
        id="workspace-sidebar"
        ref={sidebarRef}
        className={`sidebar${mobile ? " open" : ""}`}
        aria-label="Inventory sidebar"
      >
        <Link
          to="/"
          className="brand"
          aria-label="SBM Inventory home"
          onClick={() => setMobile(false)}
        >
          <div className="brand-symbol">
            s<span>b</span>m<span className="brand-dot">.</span>
          </div>
          <span>Inventory</span>
        </Link>
        <nav aria-label="Main navigation">
          {links
            .filter((l) => !l.admin || user.role === "admin")
            .map((l) => (
              <NavLink
                end
                to={l.to}
                key={l.to}
                onClick={() => setMobile(false)}
              >
                <l.icon size={19} aria-hidden="true" />
                <span>{l.name}</span>
              </NavLink>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="profile">
            <span className="avatar">{user.name.slice(0, 1)}</span>
            <div>
              <strong title={user.name}>{user.name}</strong>
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
        <header className="topbar">
          <div>
            <button
              className="icon-button mobile-toggle"
              ref={menuRef}
              onClick={() => setMobile(!mobile)}
              aria-label="Open menu"
              aria-expanded={mobile}
              aria-controls="workspace-sidebar"
            >
              <Menu size={22} />
            </button>
            <span className="breadcrumb">
              <strong>
                {links.find((l) => l.to === location.pathname)?.name ||
                  "Inventory"}
              </strong>
            </span>
          </div>
          <div className="topbar-right">
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
        if (
          !axios.isAxiosError(e) ||
          ![401, 419].includes(e.response?.status ?? 0)
        )
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
