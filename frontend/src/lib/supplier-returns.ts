import type { SupplierReturnStatus } from "../api";

export const returnNumber = (id: number) => `SR-${String(id).padStart(6, "0")}`;
export const returnStatuses: SupplierReturnStatus[] = [
  "process",
  "delivered",
  "rejected",
];
