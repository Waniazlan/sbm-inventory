import { useState } from "react";
import { api, errorText, type Item } from "../api";
import { useApp } from "../hooks";
import { Button, ErrorBox, Modal } from "./shared";

export function DeleteItem({
  item,
  close,
  done,
}: {
  item: Item;
  close: () => void;
  done: () => void;
}) {
  const { notify } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const hasStock = item.stock !== 0;

  async function remove() {
    if (busy || hasStock) return;
    setBusy(true);
    setError("");
    try {
      await api.delete(`/items/${item.id}`);
      notify("Item deleted.");
      done();
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Delete item"
      subtitle={`${item.name} · ${item.sku}`}
      close={() => {
        if (!busy) close();
      }}
    >
      <div className="delete-item-body">
        <ErrorBox message={error} />
        <p>
          This removes the item from the catalogue and future stock operations.
          Its movement, cost and serial history will be kept.
        </p>
        {hasStock && (
          <p role="alert" className="form-help">
            This item has {item.stock} {item.unit}(s) on hand. Issue, return or
            adjust the remaining stock before deleting it.
          </p>
        )}
      </div>
      <div className="modal-footer">
        <Button variant="secondary" disabled={busy} onClick={close}>
          Cancel
        </Button>
        <Button
          variant="danger"
          disabled={busy || hasStock}
          onClick={() => void remove()}
        >
          {busy ? "Deleting…" : "Delete item"}
        </Button>
      </div>
    </Modal>
  );
}
