<?php

namespace App\Http\Controllers;

use App\Models\Category;
use App\Models\Item;
use App\Models\ItemUnit;
use App\Models\PhoneModel;
use App\Models\RepairJob;
use App\Models\Supplier;
use App\Models\User;
use App\Services\Audit;
use App\Services\UnitSerials;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class CatalogueController
{
    private const BARCODE_FORMAT_RULE = 'regex:/\A[^\x00-\x1F\x7F-\x9F]{1,500}\z/u';

    public static function query(Request $r)
    {
        $r->validate(['search' => 'nullable|string|max:200', 'barcode' => ['nullable', 'string', self::BARCODE_FORMAT_RULE], 'category_id' => 'nullable|integer', 'supplier_id' => 'nullable|integer']);
        $q = Item::with(['category', 'supplier', 'phoneModels']);
        if ($r->filled('barcode')) {
            $q->where(fn ($q) => $q->where('barcode', $r->query('barcode'))->orWhereIn('id', ItemUnit::where('serial_number', $r->query('barcode'))->select('item_id')));
        }
        if ($s = $r->query('search')) {
            $q->where(function ($q) use ($s) {
                $like = '%'.str_replace(['%', '_'], ['\%', '\_'], $s).'%';
                foreach (['sku', 'barcode', 'name', 'brand', 'part_number'] as $c) {
                    $q->orWhere($c, 'ilike', $like);
                }$q->orWhereIn('id', ItemUnit::where('serial_number', 'ilike', $like)->select('item_id'))->orWhereHas('phoneModels', fn ($q) => $q->where('brand', 'ilike', $like)->orWhere('name', 'ilike', $like))->orWhereHas('supplier', fn ($q) => $q->where('name', 'ilike', $like));
            });
        }
        if ($r->filled('category_id')) {
            $q->where('category_id', $r->integer('category_id'));
        }
        if ($r->filled('supplier_id')) {
            $q->where('supplier_id', $r->integer('supplier_id'));
        }
        if ($r->query('status') === 'low') {
            $q->whereColumn('stock', '<=', 'minimum_stock')->where('active', true);
        }
        if ($r->query('status') === 'out') {
            $q->where('stock', 0)->where('active', true);
        }
        if ($r->query('status') === 'available') {
            $q->where('stock', '>', 0)->where('active', true);
        }
        if ($r->query('status') === 'inactive') {
            $q->where('active', false);
        }

        return $q;
    }

    public static function present(Item $i, bool $cost = true): array
    {
        $d = $i->toArray();
        if (! $cost) {
            unset($d['cost']);
        }

        return $d;
    }

    public function index(Request $r)
    {
        $p = self::query($r)->orderBy('name')->paginate(25);
        $p->through(fn ($i) => self::present($i, $r->user()->role === 'admin'));

        return $p;
    }

    public function show(Request $r, Item $item)
    {
        return self::present($item->load(['category', 'supplier', 'phoneModels']), $r->user()->role === 'admin');
    }

    public function options()
    {
        return Item::where('active', true)->orderBy('name')->get(['id', 'sku', 'name', 'stock', 'unit', 'serial_tracking']);
    }

    public function generateBarcode()
    {
        return ['barcode' => UnitSerials::barcode()];
    }

    public function units(Request $r, Item $item)
    {
        $r->validate(['state' => 'nullable|in:available,issued', 'search' => 'nullable|string|max:120']);

        return ItemUnit::where('item_id', $item->id)
            ->when($r->filled('state'), fn ($q) => $q->where('in_stock', $r->input('state') === 'available'))
            ->when($r->filled('search'), fn ($q) => $q->where('serial_number', 'ilike', '%'.str_replace(['%', '_'], ['\\%', '\\_'], $r->input('search')).'%'))
            ->orderByDesc('id')->paginate(50);
    }

    public function save(Request $r, ?Item $item = null)
    {
        // Blank barcodes on new products are allocated by the store.
        if (! $item && ! $r->filled('barcode')) {
            $r->merge(['barcode' => UnitSerials::barcode()]);
        }
        $barcode = $r->validate([
            'barcode' => [
                $item ? 'sometimes' : 'required',
                $item && ! $item->barcode ? 'nullable' : 'required',
                'string',
                self::BARCODE_FORMAT_RULE,
                Rule::unique('items', 'barcode')->ignore($item?->id),
            ],
        ], [
            'barcode.regex' => 'The barcode must contain 1–500 characters without line breaks or control characters.',
            'barcode.unique' => 'This barcode is already assigned to another item.',
        ]);
        // SKUs are assigned on creation and cannot be changed through the API.
        $d = $r->validate(['name' => 'required|string|max:200', 'category_id' => 'required|exists:categories,id', 'supplier_id' => 'nullable|exists:suppliers,id', 'brand' => 'nullable|string|max:100', 'part_number' => 'nullable|string|max:100', 'colour' => 'nullable|string|max:80', 'capacity' => 'nullable|string|max:80', 'grade' => 'nullable|string|max:80', 'unit' => 'required|in:piece,set,pack', 'cost' => 'required|integer|min:0|max:100000000', 'price' => 'nullable|integer|min:0|max:100000000', 'minimum_stock' => 'required|integer|min:0|max:100000000', 'active' => 'required|boolean', 'notes' => 'nullable|string|max:2000', 'phone_model_ids' => 'present|array|max:100', 'phone_model_ids.*' => 'required|integer|distinct|exists:phone_models,id']);

        $d = array_merge($d, $barcode, $r->validate(['serial_tracking' => 'sometimes|boolean']));

        try {
            return DB::transaction(function () use ($d, $item) {
                $ids = $d['phone_model_ids'];
                unset($d['phone_model_ids']);
                $item = $item?->exists ? Item::whereKey($item->id)->lockForUpdate()->firstOrFail() : null;
                if ($d['barcode'] ?? null) {
                    DB::select('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))', ['inventory:identifier:'.$d['barcode']]);
                    if (ItemUnit::where('serial_number', $d['barcode'])->exists()) {
                        throw ValidationException::withMessages(['barcode' => 'This value is already assigned to an individual unit serial.']);
                    }
                }
                $before = $item?->load('phoneModels')->toArray();
                if ($item?->serial_tracking && isset($d['serial_tracking']) && ! $d['serial_tracking']) {
                    throw ValidationException::withMessages(['serial_tracking' => 'Serial tracking cannot be disabled after it has been enabled.']);
                }
                $enableSerials = ($d['serial_tracking'] ?? false) && ! $item?->serial_tracking;
                if ($enableSerials && ($item?->stock ?? 0) > 1000) {
                    throw ValidationException::withMessages(['serial_tracking' => 'Enable tracking for products with at most 1,000 existing units.']);
                }
                if ($item) {
                    $item->update($d);
                } else {
                    $item = Item::create($d);
                    $d['sku'] = $item->sku;
                }
                if ($enableSerials) {
                    for ($n = 0; $n < $item->stock; $n++) {
                        UnitSerials::create($item);
                    }
                }
                $item->phoneModels()->sync($ids);
                Audit::record($before ? 'item.updated' : 'item.created', (string) $item->id, ['before' => $before, 'after' => $d, 'phone_model_ids' => $ids]);

                return $item->load(['category', 'supplier', 'phoneModels']);
            });
        } catch (UniqueConstraintViolationException $e) {
            // A second save can claim the same barcode after request validation.
            if (str_contains($e->getMessage(), 'items_barcode_unique')) {
                throw ValidationException::withMessages(['barcode' => 'This barcode is already assigned to another item.']);
            }
            throw $e;
        }
    }

    public function metadata(Request $r)
    {
        return ['categories' => Category::orderBy('name')->get(), 'phone_models' => PhoneModel::orderBy('brand')->orderBy('name')->get(), 'suppliers' => Supplier::orderBy('name')->get(), 'timezone' => config('sbm.timezone'), 'valuation_method' => 'Standard cost: current item cost × on-hand quantity. Receipt costs are retained separately.'];
    }

    public function createMetadata(Request $r, string $kind)
    {
        $class = match ($kind) {
            'categories' => Category::class,'phone-models' => PhoneModel::class,'suppliers' => Supplier::class,default => abort(404)
        };
        $rules = ['name' => 'required|string|max:150'];
        if ($kind === 'phone-models') {
            $rules['brand'] = 'required|string|max:100';
            $rules['name'] = [...explode('|', $rules['name']), Rule::unique('phone_models')->where('brand', $r->input('brand'))];
        } else {
            $rules['name'] .= '|unique:'.$kind.',name';
        }if ($kind === 'suppliers') {
            $rules['contact'] = 'nullable|string|max:200';
        }$d = $r->validate($rules);

        return DB::transaction(function () use ($class, $d, $kind) {
            $v = $class::create($d);
            Audit::record($kind.'.created', (string) $v->id, $d);

            return response()->json($v, 201);
        });
    }

    public function users()
    {
        return User::orderBy('name')->get();
    }

    public function saveUser(Request $r, ?User $user = null)
    {
        $d = $r->validate(['name' => 'required|string|max:150', 'email' => ['required', 'email', 'max:200', Rule::unique('users')->ignore($user?->id)], 'role' => 'required|in:admin,technician', 'active' => 'required|boolean', 'password' => [$user ? 'nullable' : 'required', 'string', 'min:12', 'max:200']]);
        if (empty($d['password'])) {
            unset($d['password']);
        }

        return DB::transaction(function () use ($r, $user, $d) {
            DB::select("SELECT pg_advisory_xact_lock(hashtextextended('inventory:staff',0))");
            if ($user && $user->id === $r->user()->id) {
                abort_if($d['role'] !== 'admin' || ! $d['active'], 422, 'You cannot disable or demote your own account.');
            }if ($user) {
                $user->update($d);
            } else {
                $user = User::create($d);
            }Audit::record('user.saved', (string) $user->id, array_diff_key($d, ['password' => true]));

            return $user;
        });
    }

    public function jobs(Request $r)
    {
        return RepairJob::with('technician:id,name')->when($r->user()->role !== 'admin', fn ($q) => $q->where('technician_id', $r->user()->id))->when($r->filled('search'), fn ($q) => $q->where('reference', 'ilike', '%'.$r->input('search').'%'))->orderByDesc('id')->paginate(25);
    }

    public function saveJob(Request $r)
    {
        $d = $r->validate(['reference' => 'required|string|max:120', 'technician_id' => ['required', Rule::exists('users', 'id')->where('active', true)->where('role', 'technician')], 'active' => 'required|boolean']);

        return DB::transaction(function () use ($d) {
            $j = RepairJob::updateOrCreate(['reference' => $d['reference']], $d);
            Audit::record('repair.assignment', (string) $j->id, $d);

            return $j;
        });
    }
}
