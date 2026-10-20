<?php

namespace Sbm\SsoClient;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Throwable;

class SsoController
{
    public function configuration(CentralSession $central)
    {
        return response()->json(['enabled' => (bool) $central->configured(), 'redirect_url' => '/auth/sso/redirect'])->header('Cache-Control', 'no-store');
    }

    public function redirect(Request $request, CentralSession $central)
    {
        abort_unless($central->configured(), 404);
        if ($request->has('application_id')) {
            abort_unless((string) $request->query('application_id') === (string) config('sbm-sso.application_id'), 403);
        }
        $request->session()->put('sbm_sso_pending', [
            'application_id' => config('sbm-sso.application_id'), 'branch_id' => config('sbm-sso.branch_id'), 'started_at' => time(),
        ]);

        return $central->provider()->with(['application_id' => config('sbm-sso.application_id')])->redirect()->header('Cache-Control', 'no-store');
    }

    public function callback(Request $request, CentralSession $central)
    {
        abort_unless($central->configured(), 404);
        $pending = $request->session()->pull('sbm_sso_pending');
        try {
            abort_unless(is_array($pending) && $pending['application_id'] === config('sbm-sso.application_id')
                && $pending['branch_id'] === config('sbm-sso.branch_id') && $pending['started_at'] >= time() - 300, 403);
            // The maintained OIDC driver validates state, PKCE, nonce, issuer, audience and signature.
            $identity = $central->provider()->user();
            $subject = (string) $identity->getId();
            abort_unless($subject !== '' && is_string($identity->token) && $identity->token !== '', 403);
            $status = $central->probe($identity->token);
            abort_unless($status->successful() && $central->matches($status->json(), $subject), 403);
            $link = AccountLink::where('issuer', config('sbm-sso.issuer'))->where('subject', $subject)
                ->where('application_id', config('sbm-sso.application_id'))->first();
            $user = $link ? $central->localUser($link) : null;
            abort_unless($user, 403);
            $request->attributes->set('sbm_sso_login', true);
            Auth::guard('web')->login($user);
            $request->session()->regenerate();
            $guard = Auth::guard('web');
            $request->session()->put('password_hash_web', $guard->hashPasswordForCookie($user->getAuthPassword()));
            $request->session()->put('sbm_sso', [
                'subject' => $subject, 'link_id' => $link->id, 'user_id' => $user->getAuthIdentifier(),
                'token' => encrypt($identity->token), 'issuer' => config('sbm-sso.issuer'),
                'application_id' => config('sbm-sso.application_id'), 'branch_id' => config('sbm-sso.branch_id'),
            ]);

            return redirect(config('sbm-sso.home_path'))->header('Cache-Control', 'no-store')->header('Referrer-Policy', 'no-referrer');
        } catch (Throwable $exception) {
            // Do not log code/token-bearing URLs, exception payloads, or credentials.
            logger()->notice('SmartBusinessManager SSO sign-in rejected.', ['type' => $exception::class]);

            return redirect(config('sbm-sso.login_path').'?sso_error=1')->header('Cache-Control', 'no-store')->header('Referrer-Policy', 'no-referrer');
        } finally {
            $request->session()->forget(['state', 'code_verifier', 'openidconnect_nonce']);
        }
    }
}
