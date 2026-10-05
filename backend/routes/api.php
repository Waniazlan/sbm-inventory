<?php

use App\Http\Controllers\AuthController;
use App\Http\Controllers\CatalogueController;
use App\Http\Controllers\IntegrationController;
use App\Http\Controllers\StockController;
use App\Services\Ledger;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

Route::prefix('v1')->group(function () {
    Route::post('auth/login', [AuthController::class, 'login'])->middleware(['web', 'throttle:login']);
    Route::middleware(['auth:sanctum', 'active', 'throttle:120,1'])->group(function () {
        Route::get('auth/me', [AuthController::class, 'me']);
        Route::post('auth/logout', [AuthController::class, 'logout'])->middleware('web');
        Route::get('dashboard', [StockController::class, 'dashboard']);
        Route::get('metadata', [CatalogueController::class, 'metadata']);
        Route::get('items', [CatalogueController::class, 'index']);
        Route::get('items/{item}', [CatalogueController::class, 'show']);
        Route::get('movements', [StockController::class, 'index']);
        Route::post('movements', [StockController::class, 'post']);
        Route::get('repair-jobs', [CatalogueController::class, 'jobs']);
        Route::middleware('admin')->group(function () {
            Route::post('items', [CatalogueController::class, 'save']);
            Route::put('items/{item}', [CatalogueController::class, 'save']);
            Route::post('metadata/{kind}', [CatalogueController::class, 'createMetadata']);
            Route::get('users', [CatalogueController::class, 'users']);
            Route::post('users', [CatalogueController::class, 'saveUser']);
            Route::put('users/{user}', [CatalogueController::class, 'saveUser']);
            Route::post('repair-jobs', [CatalogueController::class, 'saveJob']);
            Route::get('reports', [StockController::class, 'report']);
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
    Route::post('repair/usage', fn (Request $r, Ledger $l) => app(IntegrationController::class)->post($r,$l,'out'))->middleware(['integration:repair', 'throttle:120,1']);
});
