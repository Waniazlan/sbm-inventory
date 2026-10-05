import axios from "axios";
export const api = axios.create({
  baseURL: "/api/v1",
  withCredentials: true,
  withXSRFToken: true,
  headers: { Accept: "application/json" },
});
export async function csrf() {
  await axios.get("/sanctum/csrf-cookie", { withCredentials: true });
}
export function errorText(e: unknown): string {
  if (axios.isAxiosError(e)) {
    const errors = e.response?.data?.errors;
    return errors
      ? Object.values(errors).flat().join(" ")
      : e.response?.data?.message ||
          "Connection interrupted. Retry the same request to check its result.";
  }
  return e instanceof Error ? e.message : "Something went wrong.";
}
export type User = {
  id: number;
  name: string;
  email: string;
  role: "admin" | "technician";
  active: boolean;
};
export type Named = { id: number; name: string };
export type Phone = Named & { brand: string };
export type Item = {
  id: number;
  sku: string;
  name: string;
  category_id: number;
  supplier_id: number | null;
  category: Named;
  supplier: Named | null;
  phone_models: Phone[];
  brand: string | null;
  part_number: string | null;
  colour: string | null;
  grade: string | null;
  capacity: string | null;
  unit: string;
  cost?: number;
  price: number | null;
  minimum_stock: number;
  stock: number;
  active: boolean;
  notes: string | null;
};
export type Movement = {
  id: number;
  item: { id: number; sku: string; name: string };
  type: string;
  delta: number;
  balance_before: number;
  balance_after: number;
  source: string;
  reference: string | null;
  actor: Named | null;
  actor_reference: string | null;
  reason: string;
  occurred_at: string;
  reversal: { id: number } | null;
  reverses_id: number | null;
  unit_cost?: number;
};
export type Job = {
  id: number;
  reference: string;
  technician_id: number;
  technician: Named;
  active: boolean;
};
export type Page<T> = {
  data: T[];
  current_page: number;
  last_page: number;
  total: number;
};
export type Metadata = {
  categories: Named[];
  suppliers: Named[];
  phone_models: Phone[];
  timezone: string;
  valuation_method: string;
};
export const money = (n: number | null | undefined) =>
  n == null
    ? "—"
    : new Intl.NumberFormat("en-MY", {
        style: "currency",
        currency: "MYR",
      }).format(n / 100);
export const label = (s: string) =>
  s.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
