<?php

namespace App\Http\Controllers;

use App\Models\Category;
use App\Models\Operation;
use App\Models\PhoneModel;
use App\Models\Supplier;
use App\Services\Audit;
use App\Services\Ledger;
use Illuminate\Http\Request;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class SalesCatalogueController
{
    public function metadata()
    {
        return [
            'categories' => Category::orderBy('name')->get(['id', 'name']),
            'phone_models' => PhoneModel::orderBy('brand')->orderBy('name')->get(['id', 'brand', 'name']),
            'suppliers' => Supplier::orderBy('name')->get(['id', 'name']),
        ];
    }

    public function store(Request $r, CatalogueController $catalogue, IntegrationController $integration, Ledger $ledger)
    {
        $r->merge(['request_key' => $r->header('Idempotency-Key')]);
        $context = $r->validate([
            'request_key' => 'required|string|max:150', 'actor_reference' => 'required|string|max:150',
            'price' => 'required|integer|min:0|max:100000000',
            'receipt' => 'required|array:supplier_id,reference,quantity,unit_cost,brand,batch,serials',
            'receipt.supplier_id' => 'nullable|integer|min:1',
            'receipt.reference' => 'required_without:receipt.supplier_id|nullable|string|max:120',
            'receipt.quantity' => 'required|integer|min:1|max:1000',
            'receipt.unit_cost' => 'required|integer|min:0|max:100000000',
            'receipt.brand' => 'nullable|string|max:100', 'receipt.batch' => 'nullable|string|max:150',
            'receipt.serials' => 'nullable|string|max:130000',
        ]);
        // Stock is posted through the ledger; clients cannot set catalogue stock or costs.
        $payload = $r->only(['name', 'barcode', 'category_id', 'price', 'unit', 'minimum_stock',
            'serial_tracking', 'colour', 'capacity', 'grade', 'notes', 'phone_model_ids']);
        $payload['active'] = true;
        $fingerprint = hash('sha256', json_encode(Arr::sortRecursive([
            'item' => $payload, 'receipt' => $context['receipt'], 'actor_reference' => $context['actor_reference'],
        ])));
        $key = 'catalogue-with-stock:'.$context['request_key'];

        $result = DB::transaction(function () use ($r, $catalogue, $integration, $ledger, $context, $payload, $fingerprint, $key) {
            DB::select('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))', ['sales:'.$key]);
            $operation = Operation::where('source', 'sales')->where('key', $key)->first();
            if ($operation) {
                abort_unless(hash_equals($operation->fingerprint, $fingerprint), 409,
                    'This request key was already used with different item or receipt details.');

                return $operation->response;
            }
            $r->validate(['receipt.supplier_id' => 'nullable|exists:suppliers,id']);
            $receipt = $context['receipt'];
            $r->replace($payload);
            $item = $catalogue->save($r);
            try {
                // A physical stock receipt belongs to the Inventory ledger. The Sales
                // actor is retained separately; a Sales user ID is not an Inventory FK.
                $stock = $ledger->post([
                    'request_key' => 'sales-catalogue-receipt:'.$context['request_key'],
                    'kind' => 'receipt', 'reason' => 'Stock received from supplier',
                    'actor_reference' => $context['actor_reference'],
                    'supplier_id' => $receipt['supplier_id'] ?? null, 'reference' => $receipt['reference'] ?? null,
                    'items' => [['item_id' => $item->id, 'quantity' => $receipt['quantity'],
                        'unit_cost' => $receipt['unit_cost'], 'brand' => $receipt['brand'] ?? null,
                        'batch' => $receipt['batch'] ?? null, 'serials' => $receipt['serials'] ?? null]],
                ], 'inventory');
            } catch (ValidationException $error) {
                throw ValidationException::withMessages(collect($error->errors())
                    ->mapWithKeys(fn ($messages, $field) => ['receipt.'.$field => $messages])->all());
            }
            $result = $integration->productShow($item->refresh());
            $result['receipt'] = $stock;
            Operation::create([
                'source' => 'sales', 'key' => $key, 'fingerprint' => $fingerprint,
                'kind' => 'catalogue_create_with_stock', 'reference' => (string) $item->id, 'response' => $result,
            ]);
            Audit::record('item.created_from_sales', (string) $item->id,
                ['actor_reference' => $context['actor_reference'], 'request_key' => $context['request_key'],
                    'receipt_reference' => $stock['reference']], 'sales');

            return $result;
        });

        return response()->json($result, 201);
    }
}
