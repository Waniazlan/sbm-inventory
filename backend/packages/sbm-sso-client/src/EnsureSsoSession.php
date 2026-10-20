<?php

namespace Sbm\SsoClient;

use Closure;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Throwable;

class EnsureSsoSession
{
    public function handle(Request $request, Closure $next)
    {
        if (! $request->hasSession() || ! ($session = $request->session()->get('sbm_sso'))) {
            return $next($request);
        }
        // Password authentication may deliberately replace an SSO session.
        if ($request->isMethod('POST') && $request->is('api/v1/auth/login')) {
            return $next($request);
        }
        $central = app(CentralSession::class);
        $link = AccountLink::find($session['link_id'] ?? 0);
        $user = $link ? $central->localUser($link) : null;
        if (! $central->configured() || ! $user || (string) $user->getAuthIdentifier() !== (string) Auth::guard('web')->id()
            || $session['issuer'] !== config('sbm-sso.issuer') || $session['application_id'] !== config('sbm-sso.application_id')
            || $session['branch_id'] !== config('sbm-sso.branch_id') || ! hash_equals($link->subject, $session['subject'])) {
            return $this->expired($request);
        }
        try {
            $token = decrypt($session['token']);
            if ($request->isMethod('POST') && $request->is('api/v1/auth/logout')) {
                $status = $central->logout($token);
                if ($status->successful() || in_array($status->status(), [401, 403], true)) {
                    return $next($request);
                }
            } else {
                $status = $central->probe($token);
                if ($status->successful() && $central->matches($status->json(), $session['subject'])) {
                    return $next($request);
                }
                if (in_array($status->status(), [401, 403, 404], true) || $status->successful()) {
                    return $this->expired($request);
                }
            }
        } catch (ConnectionException $exception) {
            // Fail closed during portal outages, while allowing a later retry.
        } catch (Throwable $exception) {
            return $this->expired($request);
        }

        return response()->json(['message' => 'Unable to verify your SmartBusinessManager session. Please try again.'], 503);
    }

    private function expired(Request $request)
    {
        Auth::guard('web')->logout();
        $request->session()->invalidate();
        $request->session()->regenerateToken();

        return response()->json(['message' => 'Your SmartBusinessManager session ended. Please sign in again.'], 401);
    }
}
