# SmartBusinessManager single sign-on

This application uses the vendored `backend/packages/sbm-sso-client` package and the maintained Socialite OpenID Connect driver. An authorized portal administrator can open it without another password prompt. Existing staff and emergency password login stays available.

## Configure

1. Install backend dependencies (`composer install`), then run `php artisan migrate`.
2. Register the portal application using `php artisan sso:client APPLICATION_ID https://this-system.example/auth/sso/callback`. Store the printed `SBM_SSO_*` values in this application's private backend environment. Use a fixed HTTPS issuer and exact callback. HTTP is allowed only on loopback hosts in local/testing environments. Never share Laravel application keys, cookies, or databases between systems.
3. Map the portal application and branch IDs explicitly. For Tracking, also set `SBM_SSO_LOCAL_SHOP_ID` to the intended local shop; IDs from different applications are unrelated.
4. Inspect existing local administrators. Run `php artisan sso:link PORTAL_USER_ID LOCAL_USER_ID` for each authorized account. Linking requires an existing active administrator, with the configured shop where applicable. Emails never create account links or admin permissions. Use `--remove` to remove a link.
5. In the portal, enable SSO and grant the existing portal administrator access under Settings → Single sign-on. Clear cached config after changing environment values.

Keep the issuer and client secret private in environment configuration. The portal retains only the hashed client secret. This application stores access tokens encrypted in its server-side session; tokens never enter localStorage. Callback codes are single-use, protected by PKCE S256, state, nonce, signed ID-token validation and an exact redirect URI.

Every SSO-authenticated API request checks the central session plus the explicit local account link, active/admin status and shop mapping. Revoked access, removed links, branch changes and expired tokens return 401. Portal outages block protected access with 503 and allow retry. Ordinary password sessions do not depend on the portal.

Signing out of an SSO session revokes that portal account's SSO credentials across all systems and ends its database-backed portal sessions. Other open tabs lose protected access on their next API request. This does not end separate ordinary password sessions.

## Hosting

Forward `/auth/sso/*`, `/api/*` and `/sanctum/*` to Laravel. Included reverse-proxy examples cover these routes. The browser and backend must both reach the fixed portal issuer. Use separate hostnames and host-only secure session cookies. For local development, use distinct `portal.localhost`, `inventory.localhost`, `sales.localhost`, `tracking.localhost` and `visit.localhost` hosts to avoid cookie conflicts; run all APIs on distinct ports. Vite's API_PROXY_TARGET can override the backend target.

This source package is maintained in SmartBusinessManager `packages/sso-client`. When updating it, synchronize the vendored package in all subsystems and run `composer update sbm/sso-client` so Composer refreshes its mirrored copy.

## Verify

`DB_PORT=5432 php artisan test --filter=SsoClientTest` uses the application's dedicated PostgreSQL test database. It checks explicit identity links, admin/shop restrictions, callback replay, live revocation, portal outages, global logout and password fallback. Full browser verification should launch the application from the real portal and test logout across open subsystem tabs.
