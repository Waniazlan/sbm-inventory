import { useState } from "react";
import type { User } from "../api";

export function Avatar({
  user,
  className = "",
}: {
  user: User;
  className?: string;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  return (
    <span className={`avatar ${className}`}>
      {user.avatar_url && user.avatar_url !== failedUrl ? (
        <img
          src={user.avatar_url}
          alt={`${user.name}'s profile picture`}
          onError={() => setFailedUrl(user.avatar_url ?? null)}
        />
      ) : (
        user.name.slice(0, 1)
      )}
    </span>
  );
}
