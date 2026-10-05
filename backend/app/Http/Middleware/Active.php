<?php

namespace App\Http\Middleware;

class Active
{
    public function handle($request, \Closure $next)
    {
        abort_unless($request->user()?->active, 403, 'This account is disabled.');

        return $next($request);
    }
}
