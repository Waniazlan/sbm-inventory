<?php

use Illuminate\Support\Facades\Route;
use Sbm\SsoClient\SsoController;

Route::get('auth/sso/config', [SsoController::class, 'configuration'])->middleware('throttle:sbm-sso');
Route::middleware(['web', 'throttle:sbm-sso'])->prefix('auth/sso')->group(function (): void {
    Route::get('redirect', [SsoController::class, 'redirect'])->name('sbm-sso.redirect');
    Route::get('callback', [SsoController::class, 'callback'])->name('sbm-sso.callback');
});
