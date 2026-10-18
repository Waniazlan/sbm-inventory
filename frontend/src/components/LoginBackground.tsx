import { useEffect, useRef, useState } from "react";
import {
  backgroundMediaUrl,
  getLoginBackground,
  type LoginBackgroundConfig,
} from "../lib/login-background";
import "../pages/login.css";

interface Props {
  background?: LoginBackgroundConfig | null;
  onReady?: () => void;
  onError?: (message: string) => void;
}

export function LoginBackground({ background, onReady, onError }: Props) {
  const [saved, setSaved] = useState<LoginBackgroundConfig | null>(null);
  const [failedUrl, setFailedUrl] = useState("");
  const [reducedMotion, setReducedMotion] = useState(
    () =>
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
  );
  const videoRef = useRef<HTMLVideoElement>(null);
  const chosen = background === undefined ? saved : background;
  const source = chosen ? backgroundMediaUrl(chosen.url) : "";
  const media = chosen && source !== failedUrl ? chosen : null;

  useEffect(() => {
    if (background !== undefined) return;
    let active = true;
    getLoginBackground()
      .then((value) => {
        if (active) setSaved(value);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [background]);

  useEffect(() => {
    const preference = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!preference) return;
    const update = () => setReducedMotion(preference.matches);
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (reducedMotion) video.pause();
    else void video.play().catch(() => {});
  }, [source, reducedMotion]);

  function failed() {
    setFailedUrl(source);
    onError?.(
      "This file cannot be displayed. Choose another image or a browser-compatible MP4 or WebM video.",
    );
  }

  return (
    <div
      className={`login-background${media ? " has-media" : ""}`}
      aria-hidden="true"
    >
      <div className="login-aurora">
        <span className="login-aurora-beam login-aurora-blue" />
        <span className="login-aurora-beam login-aurora-cyan" />
        <span className="login-aurora-beam login-aurora-violet" />
      </div>
      <div className="login-background-stars" />
      <div className="login-background-orbits" />
      <span className="login-background-light login-background-light-one" />
      <span className="login-background-light login-background-light-two" />
      <span className="login-background-light login-background-light-three" />
      <span className="login-background-light login-background-light-four" />
      {media?.kind === "image" && (
        <img
          key={source}
          className="login-background-media"
          src={source}
          alt=""
          onLoad={onReady}
          onError={failed}
        />
      )}
      {media?.kind === "video" && (
        <video
          key={source}
          ref={videoRef}
          className="login-background-media"
          src={source}
          autoPlay={!reducedMotion}
          muted
          loop
          playsInline
          preload="auto"
          tabIndex={-1}
          onLoadedData={onReady}
          onError={failed}
        />
      )}
    </div>
  );
}
