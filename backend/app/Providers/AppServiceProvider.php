<?php

namespace App\Providers;

use App\Models\LabelSetting;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        // Read once per request, including receipts generating many serials.
        $this->app->scoped(LabelSetting::class, fn () => LabelSetting::findOrFail(1));
    }

    public function boot(): void
    {
        RateLimiter::for('login', fn (Request $request) => [Limit::perMinute(5)->by(strtolower((string) $request->input('email')).'|'.$request->ip()), Limit::perMinute(30)->by($request->ip())]);
    }
}
