<?php

namespace Sbm\SsoClient;

use Illuminate\Auth\Events\Login;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;
use Laravel\Sanctum\Http\Middleware\EnsureFrontendRequestsAreStateful;

class SsoServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->mergeConfigFrom(__DIR__.'/../config/sbm-sso.php', 'sbm-sso');
        $this->app->bind(EnsureFrontendRequestsAreStateful::class, PublicMediaStatefulRequests::class);
    }

    public function boot(): void
    {
        $this->loadMigrationsFrom(__DIR__.'/../database/migrations');
        $this->loadRoutesFrom(__DIR__.'/../routes/web.php');
        $this->app['router']->pushMiddlewareToGroup('api', EnsureSsoSession::class);
        RateLimiter::for('sbm-sso', fn (Request $request) => Limit::perMinute(60)->by($request->ip()));
        $this->commands([LinkAccount::class]);
        // A successful password login starts an independent local session.
        Event::listen(Login::class, function (Login $event): void {
            $request = request();
            if ($event->guard === 'web' && $request->hasSession() && ! $request->attributes->get('sbm_sso_login')) {
                $request->session()->forget(['sbm_sso', 'sbm_sso_pending']);
            }
        });
    }
}
