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
    // Let any active local account (not only role=admin) sign in through SSO once linked.
    'allow_staff' => (bool) env('SBM_SSO_ALLOW_STAFF', false),
    // On first SSO sign-in, link by email only when the portal marks the email verified and exactly one
    // active local account has it. Requires allow_staff. Existing links are never replaced.
    'auto_link' => (bool) env('SBM_SSO_AUTO_LINK', false),
    'user_model' => User::class,
    'home_path' => '/',
    'login_path' => '/login',
];
