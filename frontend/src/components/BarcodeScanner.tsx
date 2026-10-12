import { useEffect, useRef, useState } from "react";
import { Camera, RotateCcw } from "lucide-react";
import { Button, ErrorBox, Field, Modal } from "./shared";

export const validBarcode = (value: string) => /^[0-9]{16}$/.test(value);

// Loaded only when a photo is decoded; images never leave the browser.
async function decode(canvas: HTMLCanvasElement): Promise<string> {
  const [{ BrowserMultiFormatOneDReader }, { DecodeHintType }] =
    await Promise.all([import("@zxing/browser"), import("@zxing/library")]);
  const reader = new BrowserMultiFormatOneDReader(
    new Map([[DecodeHintType.TRY_HARDER, true]]),
  );
  // Try both orientations for labels photographed sideways.
  for (const rotated of [false, true]) {
    const source = document.createElement("canvas");
    source.width = rotated ? canvas.height : canvas.width;
    source.height = rotated ? canvas.width : canvas.height;
    const ctx = source.getContext("2d")!;
    if (rotated) {
      ctx.translate(source.width, 0);
      ctx.rotate(Math.PI / 2);
    }
    ctx.drawImage(canvas, 0, 0);
    try {
      return reader.decodeFromCanvas(source).getText();
    } catch {
      /* Try the other orientation. */
    }
  }
  throw new Error(
    "No readable barcode found. Retake with the full barcode in focus, good lighting and no glare.",
  );
}

export function BarcodeScanner({
  close,
  onConfirm,
  lookup = false,
}: {
  close: () => void;
  onConfirm: (barcode: string) => void;
  lookup?: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const generation = useRef(0);
  const [cameraAttempt, setCameraAttempt] = useState(0);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState("");
  const [value, setValue] = useState("");

  function stopCamera() {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    setReady(false);
  }

  useEffect(() => {
    const current = ++generation.current;
    setError("");
    setPreview("");
    setValue("");
    setReady(false);
    async function open() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error(
            "Camera access needs HTTPS or localhost. Choose a barcode photo or enter the digits below.",
          );
        }
        const media = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        });
        if (current !== generation.current) {
          media.getTracks().forEach((track) => track.stop());
          return;
        }
        stream.current = media;
        if (video.current) {
          video.current.srcObject = media;
          await video.current.play();
        }
      } catch (e) {
        if (current !== generation.current) return;
        stopCamera();
        setError(
          e instanceof DOMException
            ? "Camera unavailable or permission denied. Allow camera access and retry, choose a photo, or enter the digits below."
            : (e as Error).message,
        );
      }
    }
    void open();
    return () => {
      generation.current++;
      stream.current?.getTracks().forEach((track) => track.stop());
      stream.current = null;
    };
  }, [cameraAttempt]);

  async function readPhoto(canvas: HTMLCanvasElement, current: number) {
    setPreview(canvas.toDataURL("image/jpeg"));
    const result = await decode(canvas);
    if (current !== generation.current) return;
    if (!validBarcode(result)) {
      throw new Error(
        "This barcode does not contain exactly 16 digits. Check the item label and try again.",
      );
    }
    setValue(result);
  }

  async function capture(file?: File) {
    // Invalidate any pending permission request before using a supplied photo.
    const current = ++generation.current;
    setBusy(true);
    setError("");
    setValue("");
    try {
      const canvas = document.createElement("canvas");
      if (file) {
        stopCamera();
        if (!file.type.startsWith("image/") || file.size > 20 * 1024 * 1024) {
          throw new Error("Choose an image smaller than 20 MB.");
        }
        const url = URL.createObjectURL(file);
        try {
          const photo = new Image();
          photo.src = url;
          await photo.decode();
          if (current !== generation.current) return;
          const scale = Math.min(1, 2560 / Math.max(photo.width, photo.height));
          canvas.width = Math.round(photo.width * scale);
          canvas.height = Math.round(photo.height * scale);
          canvas
            .getContext("2d")!
            .drawImage(photo, 0, 0, canvas.width, canvas.height);
        } finally {
          URL.revokeObjectURL(url);
        }
      } else {
        if (!video.current?.videoWidth)
          throw new Error("Wait for the camera preview, then try again.");
        canvas.width = video.current.videoWidth;
        canvas.height = video.current.videoHeight;
        canvas.getContext("2d")!.drawImage(video.current, 0, 0);
        stopCamera();
      }
      await readPhoto(canvas, current);
    } catch (e) {
      if (current === generation.current)
        setError(
          (e as Error).message ||
            "Could not read this photo. Try a JPG or PNG photo.",
        );
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }

  return (
    <Modal
      title="Scan barcode"
      subtitle="Open camera → Snap → Review and confirm"
      close={close}
    >
      <div className="barcode-scanner">
        <p>
          Keep the entire barcode inside the frame, including the blank space at
          both ends.
        </p>
        <div className="barcode-camera">
          <video
            ref={video}
            autoPlay
            playsInline
            muted
            hidden={!!preview}
            onLoadedData={() => setReady(!!stream.current)}
            aria-label="Barcode camera preview"
          />
          {preview && <img src={preview} alt="Captured barcode" />}
          {!preview && <div className="barcode-guide" aria-hidden="true" />}
        </div>
        <ErrorBox message={error} />
        <div className="barcode-actions">
          <Button
            type="button"
            disabled={!ready || busy}
            onClick={() => void capture()}
          >
            <Camera size={17} /> {busy ? "Reading barcode…" : "Snap barcode"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => setCameraAttempt((n) => n + 1)}
          >
            <RotateCcw size={16} /> {preview ? "Retake photo" : "Retry camera"}
          </Button>
        </div>
        <Field label="Choose barcode photo">
          <input
            type="file"
            accept="image/*"
            disabled={busy}
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              e.currentTarget.value = "";
              if (file) void capture(file);
            }}
          />
        </Field>
        <Field label="Review barcode (16 digits)">
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            inputMode="numeric"
            maxLength={16}
            autoComplete="off"
            placeholder="Or enter the 16 digits manually"
            disabled={busy}
          />
        </Field>
        <p role="status">
          {validBarcode(value)
            ? "16 digits ready. Check them against the label before confirming."
            : "Exactly 16 digits required. Leading zeroes are kept."}
        </p>
        <small>
          Photos are processed on this device and are not uploaded or saved.
        </small>
      </div>
      <div className="modal-footer">
        <Button type="button" variant="secondary" onClick={close}>
          Cancel
        </Button>
        <Button
          type="button"
          disabled={busy || !validBarcode(value)}
          onClick={() => onConfirm(value)}
        >
          {lookup ? "Find item" : "Use barcode"}
        </Button>
      </div>
    </Modal>
  );
}
