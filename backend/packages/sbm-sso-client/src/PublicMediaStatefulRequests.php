<?php

namespace Sbm\SsoClient;

use Laravel\Sanctum\Http\Middleware\EnsureFrontendRequestsAreStateful;

class PublicMediaStatefulRequests extends EnsureFrontendRequestsAreStateful
{
    public static function fromFrontend($request)
    {
        // Slow public media responses must never save an older session over a new login transaction.
        // These endpoints are already public; protected and mutating requests retain Sanctum/CSRF.
        if ($request->isMethod('GET') && $request->is(
            'api/v1/login-background',
            'api/v1/login-background/media/*',
            'api/v1/ui/login-appearance',
            'api/v1/ui/login-background',
        )) {
            return false;
        }

        return parent::fromFrontend($request);
    }
}
