<?php

namespace App\Http\Middleware;

class Integration
{
    public function handle($r, \Closure $next, string $service = 'sales')
    {
        $token = config('sbm.'.$service.'_token');
        abort_unless(is_string($token) && strlen($token) >= 32 && is_string($r->bearerToken()) && hash_equals($token, $r->bearerToken()), 401, 'Invalid integration credentials.');
        $r->attributes->set('source', $service);

        return $next($r);
    }
}
