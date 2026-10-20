<?php

namespace Sbm\SsoClient;

use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;
use RuntimeException;
use SocialiteProviders\Manager\Config;
use SocialiteProviders\OpenIDConnect\Provider;

class CentralSession
{
    public function configured(): bool
    {
        return config('sbm-sso.enabled') && config('sbm-sso.issuer') && config('sbm-sso.client_id')
            && config('sbm-sso.client_secret') && config('sbm-sso.redirect_uri')
            && config('sbm-sso.application_id') > 0 && config('sbm-sso.branch_id') > 0;
    }

    public function provider(): Provider
    {
        $this->assertSafeUrl(config('sbm-sso.issuer'));
        $this->assertSafeUrl(config('sbm-sso.redirect_uri'));
        $provider = new Provider(request(), config('sbm-sso.client_id'), config('sbm-sso.client_secret'), config('sbm-sso.redirect_uri'));

        return $provider->setConfig(new Config(
            config('sbm-sso.client_id'), config('sbm-sso.client_secret'), config('sbm-sso.redirect_uri'),
            ['base_url' => config('sbm-sso.issuer'), 'issuer' => config('sbm-sso.issuer'),
                'scopes' => ['openid', 'profile', 'email'], 'use_nonce' => true, 'verify_jwt' => true,
                'http_timeout' => 8, 'http_connect_timeout' => 3, 'token_auth_method' => 'client_secret_post'],
        ));
    }

    public function probe(string $token): Response
    {
        $this->assertSafeUrl(config('sbm-sso.issuer'));

        return Http::acceptJson()->withToken($token)->connectTimeout(3)->timeout(8)
            ->withOptions(['allow_redirects' => false])->get(config('sbm-sso.issuer').'/api/sso/session');
    }

    public function logout(string $token): Response
    {
        $this->assertSafeUrl(config('sbm-sso.issuer'));

        return Http::acceptJson()->withToken($token)->connectTimeout(3)->timeout(8)
            ->withOptions(['allow_redirects' => false])->post(config('sbm-sso.issuer').'/api/sso/logout');
    }

    public function matches(array $status, string $subject): bool
    {
        return isset($status['sub'], $status['application_id'], $status['branch_id'])
            && hash_equals($subject, (string) $status['sub'])
            && (int) $status['application_id'] === config('sbm-sso.application_id')
            && (int) $status['branch_id'] === config('sbm-sso.branch_id');
    }

    public function localUser(AccountLink $link): mixed
    {
        if ($link->issuer !== config('sbm-sso.issuer') || $link->application_id !== config('sbm-sso.application_id')
            || $link->branch_id !== config('sbm-sso.branch_id')) {
            return null;
        }
        $user = config('sbm-sso.user_model')::find($link->user_id);
        if (! $user || ! $user->active || $user->role !== 'admin') {
            return null;
        }
        // Tracking must configure a shop explicitly; IDs in different applications are unrelated.
        if ($user->getAttribute('shop_id') !== null) {
            $shop = config('sbm-sso.local_shop_id');
            if (! $shop || (int) $user->shop_id !== (int) $shop || $link->local_shop_id !== (int) $shop) {
                return null;
            }
        } elseif ($link->local_shop_id !== null) {
            return null;
        }

        return $user;
    }

    public function assertSafeUrl(string $url): void
    {
        $parts = parse_url($url);
        $host = strtolower($parts['host'] ?? '');
        $loopback = in_array($host, ['localhost', '127.0.0.1', '[::1]'], true) || str_ends_with($host, '.localhost');
        if (! filter_var($url, FILTER_VALIDATE_URL) || isset($parts['user']) || isset($parts['pass'])
            || isset($parts['query']) || isset($parts['fragment'])
            || (($parts['scheme'] ?? '') !== 'https' && ! (app()->environment(['local', 'testing']) && $loopback && ($parts['scheme'] ?? '') === 'http'))) {
            throw new RuntimeException('SSO URLs require HTTPS. Loopback HTTP is allowed only in local/testing environments.');
        }
    }
}
