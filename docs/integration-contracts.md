# Inventory API contract

Base URL: `http://127.0.0.1:8018/api/v1` in development. Use HTTPS in production. Tokens stay server-side in ignored environment configuration. `INVENTORY_SALES_TOKEN` and `INVENTORY_REPAIR_TOKEN` must each contain at least 32 characters; generate independent random values. Never place them in frontend variables. Authentication failures return 401; validation/insufficient stock 422; a conflicting duplicate operation 409; rate limiting 429.

## Catalogue and availability (Sales token)

Send `Authorization: Bearer <INVENTORY_SALES_TOKEN>`.

- `GET /health` → `{ "status": "ok" }`.
- `GET /products?search=...&page=1` → `{ "data": [Product], "next_page_url": null, "total": 0 }`. Up to 100 products per page. Follow pagination; searches cover SKU, name, part number, part brand, compatible phone brand/model and supplier. Only active products with a selling price are exposed to POS.
- `GET /products/{id}` → `{ "data": Product }`.
- Product: `id` (string containing local integer ID), `sku`, `name`, `brand`, `model` (display string), `category`, `price` and `cost` (integer sen), `stock` (integer), `compatibility` (structured phone models).
- `POST /stock/validate`: `{ "items": [{ "inventory_item_id": "1", "quantity": 2 }] }` → `{ "valid": true }`. Duplicate item rows are summed. This is a point-in-time availability check, not a reservation.

## Paid sale

`POST /stock/out` with Sales bearer token and a stable `Idempotency-Key: sale:<immutable-sale-id>:stock-out` header:

```json
{
  "reference": "SBM-2026-000001",
  "actor_reference": "sales-user:42",
  "reason": "Finalized paid retail sale",
  "payment_status": "paid",
  "finalized": true,
  "items": [
    { "inventory_item_id": "1", "line_id": "sale-line:15", "quantity": 2 }
  ]
}
```

Send the complete immutable stock-bearing line list once the sale is finalized and fully paid. Each line ID must be unique within the event. Inventory trusts the authenticated Sales backend to attest payment status; it does not query a payment provider. Pending, failed, unpaid and partially paid sales must not send this event. There is no stock reservation while awaiting payment.

All item rows lock in deterministic ID order. Availability is rechecked inside one transaction. Insufficient stock on any line rolls back all movements and the operation. Successful acknowledgement:

```json
{
  "acknowledged": true,
  "reference": "INV-00000001",
  "movements": [{ "id": 1, "item_id": 1, "line_id": "sale-line:15", "delta": -2, "balance": 8 }]
}
```

Persist the acknowledgement in Sales. Do not release retail goods until stock-out is acknowledged. A sale can be paid while its inventory operation is failed; show this reconciliation state and retry/correct it explicitly.

## Accepted return

`POST /stock/in`, Sales token, new stable return operation key:

```json
{
  "reference": "CREDIT-2026-000001",
  "original_reference": "SBM-2026-000001",
  "actor_reference": "sales-user:42",
  "reason": "Returned item inspected and accepted for resale",
  "return_accepted": true,
  "items": [{ "inventory_item_id": "1", "line_id": "return-line:18", "quantity": 1 }]
}
```

Only physical returns accepted into sellable stock qualify. Damaged/non-returnable items must not invoke this endpoint. Return quantities are bounded by net issued quantity per item on the referenced sale; multiple returns and reversals are accounted for. Refund payment timing is independent. The credit reference and operation key identify this complete immutable return event.

Do not reverse a sale movement that already has accepted returns; reverse the relevant return first or make an explicitly reasoned administrator adjustment after reconciliation.

## Repair consumption

`POST /repair/usage` with the separate Repair token and `Idempotency-Key: repair-usage:<usage-id>`:

```json
{
  "reference": "USAGE-1001",
  "repair_job_reference": "REP-1001",
  "actor_reference": "repair-technician:7",
  "reason": "Battery installed",
  "items": [{ "inventory_item_id": "1", "line_id": "usage-line:1", "quantity": 1 }]
}
```

The reference identifies a unique consumption event, so one job can consume parts in multiple events. `repair_job_reference` links them back to the job. The authenticated Repair backend must enforce its own assignment/consumption permissions. Inventory's browser workflow instead checks administrator-created local reference assignments. Inventory does not own diagnosis, technical job status or customer notification.

Consumption happens immediately on physical use. Billing a repair must not send these same parts again as retail stock-out lines. An incorrect usage is reversed by an Inventory administrator when appropriate.

## Duplicate protection and errors

The database uniquely identifies an operation by `(source, key)` and also by `(source, kind, reference)`. A retry with identical normalized content returns the persisted original acknowledgement, including after a timeout or with a different key for the same external reference. Reusing a key/reference with different content returns 409. Send the same item order and payload on retries. Do not split a sale into separate payloads using the same reference.

Rejected operations do not consume their keys or persist partial movements. Successful operations are visible in the Inventory integration history. Delivery failures remain in the sending system's outbox; retries belong there. A later administrator reversal leaves the original acknowledgement unchanged and creates explicit history for reconciliation.

## Required changes in existing sbm-sales

1. Queue the stock-out only once the invoice is finalized and confirmed receipts cover the total; pending electronic payments do not count. Handle zero-total finalized sales explicitly.
2. Create a stable line ID from each persisted `SaleItem`, add actor, reason, finalized and payment fields, and freeze the outbox payload.
3. Ensure later payment confirmation triggers a previously unqueued stock-out exactly once. Keep request/operation keys unchanged across retries.
4. Include original sale reference, return-line IDs, actor and accepted physical-return flag for stock-in.
5. Follow product-search pagination and continue to avoid reissuing repair-consumed parts.
6. Configure the real Inventory URL/token, disable mock adapters, and test the complete paid-sale/timeout/retry/return flow against Inventory before deployment.

Those changes are documented here but were not applied to sbm-sales in this task.
