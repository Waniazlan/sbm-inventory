# Requirements mapping

Source: `SBM_Inventory_Management_Requirements.docx`, version 1.0 initial draft. The document was treated as product requirements, not as authority to execute unrelated instructions.

| Requirement | Implementation |
| --- | --- |
| FR-01 catalogue | Item CRUD, unique SKU, category/unit/cost/price/minimum/active fields; no direct quantity overwrite |
| FR-02 compatibility | Many-to-many phone models and structured part variant fields |
| FR-03 receipts | Quantity, supplier/reference, unit cost, receiving actor/time, batch/serial annotations |
| FR-04 issues | Mandatory reason, actor, source reference for sales/repair; administrator-only manual issue |
| FR-05 balance | Ledger sum with transactionally maintained, nonnegative cached balance and reconciliation command |
| FR-06 adjustments | Physical count creates delta; before/after, reason, administrator and optional approval note retained |
| FR-07 immutable ledger | PostgreSQL update/delete prevention; explicit linked reversals; no deletion API |
| FR-08 low stock | Active items at/below minimum in catalogue, dashboard and report |
| FR-09 search/filter | Item/SKU/part brand/model/supplier search; category/status filters; movement reference/date/type/user filtering |
| FR-10 reports | Current, low, movements, reasons, repair, sales and standard-cost valuation; CSV export |
| FR-11 Sales integration | Paid/finalized event endpoint, transaction and line IDs, stable acknowledgements and duplicate protection; sender adapter update still needed |
| FR-12 Repair integration | Usage event and job references; assigned technician browser workflow; external sender owns its assignment authorization |
| FR-13 audit | Item changes, stock operations, assignments, staff/reference creation and reversals recorded; immutable audit table |

The administrator is the authorized approver for direct stock adjustments; there is no separate pending-approval workflow. Technicians cannot receive or manually adjust stock. Their ledger access is scoped to their own movements.

Decisions used for this initial system: single location; no reservations; whole units; actual repair usage deducted immediately; retail stock deducted only after confirmed full payment/finalization; accepted returns recorded independently of financial refunds; standard-cost valuation. Batch and serial annotations do not constitute tracked individual serial inventory. Purchasing, multi-branch transfers and barcode scanning remain outside the initial scope.
