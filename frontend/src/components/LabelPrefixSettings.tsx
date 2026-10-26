import { useEffect, useState, type FormEvent } from "react";
import { api, errorText } from "../api";
import { useApp, useLoad } from "../hooks";
import { Button, ErrorBox, Field, Status } from "./shared";
import "./label-prefix-settings.css";

type Prefixes = {
  sku_prefix: string;
  barcode_prefix: string;
  serial_prefix: string;
};

export function LabelPrefixSettings() {
  const settings = useLoad<Prefixes>("/settings/labels");
  const { notify } = useApp();
  const [values, setValues] = useState<Prefixes | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (settings.data) setValues(settings.data);
  }, [settings.data]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!values || busy) return;
    setBusy(true);
    setError("");
    try {
      const { data } = await api.put<Prefixes>("/settings/labels", values);
      setValues(data);
      notify("Label prefixes saved.");
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Status {...settings} retry={settings.reload}>
      <form
        className="label-prefix-settings"
        onSubmit={save}
        aria-label="Label prefixes"
      >
        <h2>Label prefixes</h2>
        <p className="form-help">
          Choose the prefixes for newly generated codes. Existing codes stay the
          same, and numbering continues from the current sequence.
        </p>
        <ErrorBox message={error} />
        {values && (
          <fieldset className="form-grid" disabled={busy}>
            {(
              [
                ["sku_prefix", "SKU prefix", "000001"],
                ["barcode_prefix", "Product barcode prefix", "00000001"],
                ["serial_prefix", "Serial number prefix", "0000000001-12050-7"],
              ] as const
            ).map(([key, label, example]) => (
              <Field key={key} label={label}>
                <input
                  required
                  maxLength={20}
                  pattern={"[A-Za-z0-9]+(?:[_\\-][A-Za-z0-9]+)*"}
                  title="Use letters and numbers, with hyphens or underscores between them."
                  value={values[key]}
                  onChange={(event) =>
                    setValues({ ...values, [key]: event.target.value })
                  }
                />
                <small>
                  Example: {values[key]}-{example}
                </small>
              </Field>
            ))}
          </fieldset>
        )}
        <p className="form-help">
          Use up to 20 letters or numbers, with hyphens or underscores between
          them. The separator before the sequence is added automatically. Serial
          numbers keep the intake cost in sen and supplier ID after the
          sequence.
        </p>
        <div className="row-actions">
          <Button disabled={!values || busy}>
            {busy ? "Saving…" : "Save label prefixes"}
          </Button>
        </div>
      </form>
    </Status>
  );
}
