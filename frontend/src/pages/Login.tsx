import { useRef, useState, type FormEvent } from "react";
import {
  AlertCircle,
  ArrowRight,
  Eye,
  EyeOff,
  Layers3,
  Loader2,
  LockKeyhole,
  Mail,
} from "lucide-react";
import { LoginBackground } from "../components/LoginBackground";
import { Button } from "../components/shared";
import { api, csrf, errorText } from "../api";
import type { User } from "../api";
import "./login.css";

export function Login({ done }: { done: (user: User) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [validated, setValidated] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const emailInvalid = !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError("");
    setValidated(true);
    if (emailInvalid || !password) {
      setError("Enter a valid email address and your password.");
      (emailInvalid ? emailRef : passwordRef).current?.focus();
      return;
    }
    setBusy(true);
    try {
      await csrf();
      const { data } = await api.post<User>("/auth/login", {
        email: email.trim(),
        password,
      });
      done(data);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-shell">
      <LoginBackground />
      <div className="login-content">
        <div className="login-brand">
          <span className="brand-mark">
            <Layers3 size={23} aria-hidden="true" />
          </span>
          <span>
            SBM Inventory<small>Smart Business Manager</small>
          </span>
        </div>
        <section className="login-panel" aria-labelledby="login-heading">
          <div className="login-card">
            <h1 id="login-heading" className="login-enter">
              Sign in
            </h1>
            <p className="login-description login-enter">
              Welcome back. Let’s get your day started.
            </p>
            <form onSubmit={submit} noValidate aria-busy={busy}>
              <div id="login-error">
                {error && (
                  <div role="alert" className="login-notice">
                    <AlertCircle size={18} aria-hidden="true" />
                    <span>{error}</span>
                  </div>
                )}
              </div>
              <div className="login-field login-enter">
                <label htmlFor="email">Email address</label>
                <div className="login-input-wrap">
                  <Mail
                    size={18}
                    className="login-input-icon"
                    aria-hidden="true"
                  />
                  <input
                    ref={emailRef}
                    id="email"
                    name="email"
                    type="email"
                    inputMode="email"
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    disabled={busy}
                    aria-invalid={validated && emailInvalid}
                    aria-describedby={error ? "login-error" : undefined}
                    required
                  />
                </div>
              </div>
              <div className="login-field login-enter">
                <label htmlFor="password">Password</label>
                <div className="password-input">
                  <LockKeyhole
                    size={18}
                    className="login-input-icon"
                    aria-hidden="true"
                  />
                  <input
                    ref={passwordRef}
                    id="password"
                    name="password"
                    type={show ? "text" : "password"}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    disabled={busy}
                    aria-invalid={validated && !password}
                    aria-describedby={error ? "login-error" : undefined}
                    required
                  />
                  <button
                    type="button"
                    aria-label={show ? "Hide password" : "Show password"}
                    aria-pressed={show}
                    aria-controls="password"
                    disabled={busy}
                    onClick={() => setShow(!show)}
                  >
                    {show ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>
              <Button
                type="submit"
                className="login-submit login-enter"
                disabled={busy}
              >
                {busy && (
                  <Loader2
                    size={17}
                    className="login-spinner"
                    aria-hidden="true"
                  />
                )}
                {busy ? "Signing in…" : "Sign in"}
                {!busy && (
                  <ArrowRight
                    size={18}
                    className="login-submit-arrow"
                    aria-hidden="true"
                  />
                )}
              </Button>
            </form>
          </div>
        </section>
      </div>
    </main>
  );
}
