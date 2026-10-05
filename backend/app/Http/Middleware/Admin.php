<?php

namespace App\Http\Middleware;

class Admin
{
    public function handle($request, \Closure $next)
    {
        abort_unless($request->user()?->role === 'admin', 403, 'Administrator access required.');

        return $next($request);
    }
}
