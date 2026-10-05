import { createContext, useContext, useEffect, useState } from "react";
import { api, errorText, type Metadata, type User } from "./api";
export const Context = createContext<{
  user: User;
  meta: Metadata;
  reload: () => void;
  notify: (s: string) => void;
}>({} as never);
export const useApp = () => useContext(Context);
export function useLoad<T>(url: string) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [version, setVersion] = useState(0);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError("");
    api
      .get<T>(url)
      .then((r) => {
        if (live) setData(r.data);
      })
      .catch((e) => {
        if (live) setError(errorText(e));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [url, version]);
  return { data, error, loading, reload: () => setVersion((v) => v + 1) };
}
