<?php

use App\Models\User;

return [
    'enabled' => (bool) env('SBM_SSO_ENABLED', false),
    // Canonical public portal URL. HTTPS is required except on loopback development hosts.
    'issuer' => rtrim((string) env('SBM_SSO_ISSUER', ''), '/'),
    'client_id' => env('SBM_SSO_CLIENT_ID', ''),
    'client_secret' => env('SBM_SSO_CLIENT_SECRET', ''),
    'redirect_uri' => env('SBM_SSO_REDIRECT_URI', ''),
    'application_id' => (int) env('SBM_SSO_APPLICATION_ID', 0),
    'branch_id' => (int) env('SBM_SSO_BRANCH_ID', 0),
    // Only Tracking has shop-scoped users. Set this explicitly there.
    'local_shop_id' => env('SBM_SSO_LOCAL_SHOP_ID'),
    'user_model' => User::class,
    'home_path' => '/',
    'login_path' => '/login',
];
