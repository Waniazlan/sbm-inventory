import { useEffect, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import { Button, ErrorBox, Field, Modal } from "./shared";

import {
  BARCODE_MAX_LENGTH,
  decodeBarcode,
  NoBarcodeFound,
  scanAngles,
  validBarcode,
} from "../lib/barcode";

export function BarcodeScanner({
  close,
  onConfirm,
  lookup = false,
  mode = "barcode",
}: {
  close: () => void;
  onConfirm: (barcode: string) => void;
  lookup?: boolean;
  mode?: "barcode" | "serial";
}) {
  const serial = mode === "serial";
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const generation = useRef(0);
  const scanTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [cameraAttempt, setCameraAttempt] = useState(0);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState("");
  const [value, setValue] = useState("");

  function releaseCamera() {
    if (scanTimer.current !== null) clearTimeout(scanTimer.current);
    scanTimer.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
  }

  function stopCamera() {
    releaseCamera();
    setReady(false);
  }

  async function scanFrame(current: number, attempt = 0) {
    if (current !== generation.current || !stream.current) return;
    const camera = video.current;
    if (camera && camera.readyState >= 2 && camera.videoWidth) {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = camera.videoWidth;
        canvas.height = camera.videoHeight;
        canvas.getContext("2d")!.drawImage(camera, 0, 0);
        const result = await decodeBarcode(
          canvas,
          scanAngles[attempt % scanAngles.length],
        );
        if (current !== generation.current || !stream.current) return;
        if (validBarcode(result)) {
          setPreview(canvas.toDataURL("image/jpeg"));
          setValue(result);
          setError("");
          stopCamera();
          return;
        }
        setError(
          `Detected "${result}" (${result.length} characters). Use up to 500 characters without line breaks or control characters. Keep scanning a valid item label.`,
        );
      } catch (error) {
        if (current !== generation.current || !stream.current) return;
        if (!(error instanceof NoBarcodeFound)) {
          stopCamera();
          setError(
            "The live barcode reader could not start or read the camera. Retry the camera or reload this page. " +
              (error instanceof Error ? error.message : ""),
          );
          return;
        }
      }
    }
    if (current === generation.current && stream.current) {
      scanTimer.current = setTimeout(
        () => void scanFrame(current, attempt + 1),
        250,
      );
    }
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
            "Camera access needs HTTPS or localhost. Choose a barcode photo or enter the barcode below.",
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
        // Some phone cameras need continuous autofocus for nearby labels.
        // Unsupported or rejected focus settings must not prevent scanning.
        const track = media.getVideoTracks()[0];
        const capabilities = track?.getCapabilities?.() as
          (MediaTrackCapabilities & { focusMode?: string[] }) | undefined;
        if (capabilities?.focusMode?.includes("continuous")) {
          void track
            .applyConstraints({
              advanced: [
                { focusMode: "continuous" } as MediaTrackConstraintSet,
              ],
            })
            .catch(() => {});
        }
        if (video.current) {
          video.current.srcObject = media;
          await video.current.play();
          if (current === generation.current) void scanFrame(current);
        }
      } catch (e) {
        if (current !== generation.current) return;
        stopCamera();
        setError(
          e instanceof DOMException
            ? "Camera unavailable or permission denied. Allow camera access and retry, choose a photo, or enter the barcode below."
            : (e as Error).message,
        );
      }
    }
    void open();
    return () => {
      generation.current++;
      releaseCamera();
    };
  }, [cameraAttempt]);

  async function capture(file: File) {
    // Invalidate any pending permission request before using a supplied photo.
    const current = ++generation.current;
    setBusy(true);
    setError("");
    setValue("");
    stopCamera();
    try {
      const canvas = document.createElement("canvas");
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
      setPreview(canvas.toDataURL("image/jpeg"));
      const result = await decodeBarcode(canvas);
      if (current !== generation.current) return;
      if (!validBarcode(result)) {
        throw new Error(
          "Use 1–500 characters without line breaks or control characters. Check the item label and try again.",
        );
      }
      setValue(result);
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
      className="barcode-dialog"
      title={serial ? "Scan serial number" : "Scan barcode"}
      subtitle="Open camera → Automatic detection → Review and confirm"
      close={close}
    >
      <div className="barcode-scanner">
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
            variant="secondary"
            disabled={busy}
            onClick={() => setCameraAttempt((n) => n + 1)}
          >
            <RotateCcw size={16} /> {preview ? "Scan again" : "Retry camera"}
          </Button>
        </div>
        <Field label={serial ? "Choose serial photo" : "Choose barcode photo"}>
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
        <input
          aria-label={
            serial ? "Review serial number" : "Review barcode or QR value"
          }
          value={value}
          onChange={(e) => {
            generation.current++;
            stopCamera();
            setError("");
            setValue(e.target.value);
          }}
          inputMode="text"
          autoCapitalize="off"
          spellCheck={false}
          maxLength={BARCODE_MAX_LENGTH}
          autoComplete="off"
          placeholder={
            serial
              ? "Or enter the serial number manually"
              : "Or enter the barcode manually"
          }
          disabled={busy}
        />
        <p role="status">
          {validBarcode(value)
            ? `${serial ? "Serial number" : "Barcode"} captured. Check it against the label before confirming.`
            : ready
              ? "Scanning automatically… Point the camera at a barcode."
              : "Use 1–500 characters. Spaces, punctuation, leading zeroes and letter case are kept."}
        </p>
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
          {serial ? "Use serial number" : lookup ? "Find item" : "Use barcode"}
        </Button>
      </div>
    </Modal>
  );
}
