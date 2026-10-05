<?php

use App\Http\Middleware\Active;
use App\Http\Middleware\Admin;
use App\Http\Middleware\Integration;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(web: __DIR__.'/../routes/web.php', api: __DIR__.'/../routes/api.php', commands: __DIR__.'/../routes/console.php', health: '/up')
    ->withMiddleware(function (Middleware $m) {
        $m->statefulApi();
        $m->alias(['admin' => Admin::class, 'active' => Active::class, 'integration' => Integration::class]);
    })
    ->withExceptions(function (Exceptions $e) {
        $e->shouldRenderJsonWhen(fn ($r, $e) => $r->is('api/*') || $r->expectsJson());
    })->create();
