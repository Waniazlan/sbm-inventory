import { useEffect, useState } from "react";
import { AlertCircle, ArrowUpRight } from "lucide-react";
import "./sso-sign-in.css";

export function SsoSignIn() {
  const [enabled, setEnabled] = useState(false);
  const failed =
    new URLSearchParams(window.location.search).get("sso_error") === "1";

  useEffect(() => {
    const controller = new AbortController();
    fetch("/auth/sso/config", {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((config) => {
        if (!controller.signal.aborted) {
          setEnabled(
            config?.enabled === true &&
              config?.redirect_url === "/auth/sso/redirect",
          );
        }
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  if (!enabled && !failed) return null;
  return (
    <div className="login-sso">
      {failed && (
        <div className="login-notice" role="alert">
          <AlertCircle size={18} aria-hidden="true" />
          <span>
            Single sign-on could not be completed. Please try again or use your
            existing account below.
          </span>
        </div>
      )}
      {enabled && (
        <>
          <a className="login-sso-link" href="/auth/sso/redirect">
            <span>Continue with SmartBusinessManager</span>
            <ArrowUpRight size={18} aria-hidden="true" />
          </a>
          <p className="login-sso-help">
            Or sign in below with your existing account.
          </p>
        </>
      )}
    </div>
  );
}
