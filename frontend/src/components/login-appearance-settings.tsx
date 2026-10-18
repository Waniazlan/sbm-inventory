import { useEffect, useState, type ChangeEvent } from "react";
import { ImagePlus, Layers3, RotateCcw, Upload } from "lucide-react";

import { LoginBackground } from "./LoginBackground";
import { Button } from "./shared";
import { errorText } from "../api";
import {
  BACKGROUND_ACCEPT,
  getLoginBackground,
  resetLoginBackground,
  uploadLoginBackground,
  validateLoginBackgroundFile,
  type LoginBackgroundConfig,
} from "../lib/login-background";
import "./login-appearance-settings.css";

export function LoginAppearanceSettings() {
  const [background, setBackground] = useState<LoginBackgroundConfig | null>(
    null,
  );
  const [selection, setSelection] = useState<{
    file: File;
    kind: LoginBackgroundConfig["kind"];
    url: string;
  } | null>(null);
  const [previewReady, setPreviewReady] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadFailed(false);
    getLoginBackground()
      .then((value) => {
        if (active) {
          setBackground(value);
          setError("");
        }
      })
      .catch((e) => {
        if (active) {
          setError(errorText(e));
          setLoadFailed(true);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [retry]);

  useEffect(() => {
    if (!selection) return;
    return () => URL.revokeObjectURL(selection.url);
  }, [selection]);

  function choose(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError("");
    setSuccess("");
    setPreviewReady(false);
    setPreviewFailed(false);
    try {
      const kind = validateLoginBackgroundFile(file);
      setSelection({ file, kind, url: URL.createObjectURL(file) });
    } catch (e) {
      setSelection(null);
      setError(e instanceof Error ? e.message : "Unable to read this file.");
    }
  }

  async function save() {
    if (!selection || !previewReady || busy) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      setBackground(await uploadLoginBackground(selection.file));
      setSelection(null);
      setSuccess("Login background saved for everyone.");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function restore() {
    if (busy) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await resetLoginBackground();
      setBackground(null);
      setSelection(null);
      setSuccess("The animated default background has been restored.");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const preview = selection
    ? { kind: selection.kind, name: selection.file.name, url: selection.url }
    : background;

  return (
    <>
      {error && (
        <p className="appearance-feedback form-error" role="alert">
          {error}
        </p>
      )}
      {success && (
        <p className="appearance-feedback" role="status">
          {success}
        </p>
      )}
      {loading ? (
        <div className="loading" role="status">
          Loading login appearance…
        </div>
      ) : loadFailed ? (
        <Button
          variant="secondary"
          onClick={() => setRetry((value) => value + 1)}
        >
          Try again
        </Button>
      ) : (
        <div className="appearance-grid">
          <section
            className="panel appearance-controls"
            aria-labelledby="background-heading"
          >
            <div className="appearance-controls-heading">
              <div className="appearance-controls-title">
                <span className="appearance-controls-icon">
                  <ImagePlus size={22} />
                </span>
                <div>
                  <h2 id="background-heading">Login background</h2>
                  <p>
                    Choose an image or a looping video for the shared login
                    page.
                  </p>
                </div>
              </div>
            </div>
            <label htmlFor="background-file">Background file</label>
            <input
              id="background-file"
              type="file"
              accept={BACKGROUND_ACCEPT}
              disabled={busy}
              onChange={choose}
              aria-describedby="background-file-help"
            />
            <p id="background-file-help" className="appearance-hint">
              JPEG, PNG, WebP, GIF or AVIF up to 10 MB. MP4 or WebM up to 50 MB.
              Videos play muted.
            </p>
            <div className="appearance-current">
              <span>{selection ? "Selected file" : "Current background"}</span>
              <strong>
                {selection?.file.name || background?.name || "Animated aurora"}
              </strong>
              {selection && (
                <p>
                  {previewFailed
                    ? "Preview unavailable. Choose another file."
                    : previewReady
                      ? "Preview ready. Save to apply it for everyone."
                      : "Preparing preview…"}
                </p>
              )}
            </div>
            <div className="appearance-actions">
              <Button
                onClick={() => void save()}
                disabled={!selection || !previewReady || busy}
              >
                <Upload size={16} />
                {busy ? "Saving…" : "Save background"}
              </Button>
              {selection && (
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => {
                    setSelection(null);
                    setError("");
                  }}
                >
                  Cancel preview
                </Button>
              )}
              <Button
                variant="secondary"
                onClick={() => void restore()}
                disabled={busy || (!background && !selection)}
              >
                <RotateCcw size={16} />
                Restore animated default
              </Button>
            </div>
          </section>
          <section aria-label="Login background preview">
            <h2 className="appearance-preview-heading">Login preview</h2>
            <div className="appearance-preview">
              <LoginBackground
                background={preview}
                onReady={() => {
                  if (selection) setPreviewReady(true);
                }}
                onError={(message) => {
                  setPreviewReady(false);
                  setPreviewFailed(true);
                  setError(message);
                }}
              />
              <div className="appearance-preview-content">
                <div className="appearance-preview-brand">
                  <Layers3 size={23} />
                  <span>SBM Inventory</span>
                </div>
                <div className="appearance-preview-card">
                  <strong>Sign in</strong>
                  <div />
                  <div />
                  <span>Sign in</span>
                </div>
              </div>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
