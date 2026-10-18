import { api } from "../api";

export interface LoginBackgroundConfig {
  kind: "image" | "video";
  name: string;
  url: string;
}

export const BACKGROUND_ACCEPT =
  "image/jpeg,image/png,image/webp,image/gif,image/avif,video/mp4,video/webm";

export function validateLoginBackgroundFile(
  file: File,
): LoginBackgroundConfig["kind"] {
  const images = [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/avif",
  ];
  const videos = ["video/mp4", "video/webm"];
  if (!file.size) throw new Error("Choose a file that is not empty.");
  const kind = images.includes(file.type)
    ? "image"
    : videos.includes(file.type)
      ? "video"
      : null;
  if (!kind)
    throw new Error(
      "Choose a JPEG, PNG, WebP, GIF, AVIF image or an MP4 or WebM video.",
    );
  const limit = kind === "image" ? 10 : 50;
  if (file.size > limit * 1024 * 1024)
    throw new Error(
      `${kind === "image" ? "Images" : "Videos"} must be ${limit} MB or smaller.`,
    );
  return kind;
}

export async function getLoginBackground(): Promise<LoginBackgroundConfig | null> {
  const data = (await api.get("/login-background")).data.data;
  if (data === null) return null;
  if (
    (data?.kind === "image" || data?.kind === "video") &&
    typeof data.name === "string" &&
    typeof data.url === "string"
  )
    return data;
  throw new Error("Unable to load the login background.");
}

export async function uploadLoginBackground(
  file: File,
): Promise<LoginBackgroundConfig> {
  const body = new FormData();
  body.append("file", file);
  return (await api.post("/settings/login-background", body)).data.data;
}

export async function resetLoginBackground(): Promise<void> {
  await api.delete("/settings/login-background");
}

export function backgroundMediaUrl(url: string): string {
  const base = new URL(api.defaults?.baseURL || "/", window.location.origin);
  return new URL(url, base).href;
}
