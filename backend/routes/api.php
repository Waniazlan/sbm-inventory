<?php

use App\Http\Controllers\AuthController;
use App\Http\Controllers\CatalogueController;
use App\Http\Controllers\IntegrationController;
use App\Http\Controllers\LabelSettingsController;
use App\Http\Controllers\LoginBackgroundController;
use App\Http\Controllers\RepairUsageReversalController;
use App\Http\Controllers\ReportOverviewController;
use App\Http\Controllers\StockController;
use App\Http\Controllers\SupplierReturnController;
use App\Services\Ledger;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

Route::prefix('v1')->group(function () {
    Route::get('login-background', [LoginBackgroundController::class, 'show']);
    Route::get('login-background/media/{token}', [LoginBackgroundController::class, 'media'])->whereUuid('token')->name('login-background.media');
    Route::post('auth/login', [AuthController::class, 'login'])->middleware(['web', 'throttle:login']);
    Route::middleware(['auth:sanctum', 'active', 'throttle:120,1'])->group(function () {
        Route::get('auth/me', [AuthController::class, 'me']);
        Route::post('auth/logout', [AuthController::class, 'logout'])->middleware('web');
        Route::get('dashboard', [StockController::class, 'dashboard']);
        Route::get('metadata', [CatalogueController::class, 'metadata']);
        Route::get('items', [CatalogueController::class, 'index']);
        Route::get('items/options', [CatalogueController::class, 'options']);
        Route::get('items/{item}', [CatalogueController::class, 'show'])->whereNumber('item');
        Route::get('items/{item}/units', [CatalogueController::class, 'units'])->whereNumber('item');
        Route::get('movements', [StockController::class, 'index']);
        Route::post('movements', [StockController::class, 'post']);
        Route::middleware('admin')->group(function () {
            Route::get('supplier-returns/lookup', [SupplierReturnController::class, 'lookup']);
            Route::get('supplier-returns', [SupplierReturnController::class, 'index']);
            Route::post('supplier-returns', [SupplierReturnController::class, 'store']);
            Route::put('supplier-returns/{supplierReturn}', [SupplierReturnController::class, 'update'])->whereNumber('supplierReturn');
            Route::get('settings/labels', [LabelSettingsController::class, 'show']);
            Route::put('settings/labels', [LabelSettingsController::class, 'update']);
            Route::post('settings/login-background', [LoginBackgroundController::class, 'store']);
            Route::delete('settings/login-background', [LoginBackgroundController::class, 'destroy']);
            Route::get('items/{item}/batches', [CatalogueController::class, 'batches'])->whereNumber('item');
            Route::post('items', [CatalogueController::class, 'save']);
            Route::post('items/generate-barcode', [CatalogueController::class, 'generateBarcode']);
            Route::put('items/{item}/supplier-stock', [CatalogueController::class, 'editSupplierStock'])->whereNumber('item');
            Route::put('items/{item}', [CatalogueController::class, 'save'])->whereNumber('item');
            Route::delete('items/{item}', [CatalogueController::class, 'destroy'])->whereNumber('item')->withTrashed();
            Route::post('metadata/{kind}', [CatalogueController::class, 'createMetadata']);
            Route::get('users', [CatalogueController::class, 'users']);
            Route::post('users', [CatalogueController::class, 'saveUser']);
            Route::put('users/{user}', [CatalogueController::class, 'saveUser']);
            Route::get('reports', [StockController::class, 'report']);
            Route::get('reports/overview', ReportOverviewController::class);
            Route::get('audit', [StockController::class, 'audit']);
            Route::get('integrations', [IntegrationController::class, 'events']);
        });
    });
    Route::middleware(['integration:sales', 'throttle:120,1'])->group(function () {
        Route::get('health', fn () => ['status' => 'ok']);
        Route::get('products', [IntegrationController::class, 'products']);
        Route::get('products/{item}', [IntegrationController::class, 'productShow']);
        Route::post('stock/validate', [IntegrationController::class, 'validateStock']);
        Route::post('stock/{direction}', [IntegrationController::class, 'post'])->whereIn('direction', ['in', 'out']);
    });
    Route::post('repair/usage/reverse', RepairUsageReversalController::class)->middleware(['integration:repair', 'throttle:120,1']);
    Route::post('repair/usage', fn (Request $r, Ledger $l) => app(IntegrationController::class)->post($r, $l, 'out'))->middleware(['integration:repair', 'throttle:120,1']);
});
