<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\Schema;
use Mockery;
use RuntimeException;
use Sbm\SsoClient\AccountLink;
use Sbm\SsoClient\CentralSession;
use Sbm\SsoClient\PublicMediaStatefulRequests;
use SocialiteProviders\Manager\OAuth2\User as Identity;
use SocialiteProviders\OpenIDConnect\Provider;
use Tests\TestCase;

/** Copy into each subsystem's tests/Feature directory; uses its dedicated test DB. */
class SsoClientTest extends TestCase
{
    use RefreshDatabase;

    private const ISSUER = 'https://portal.example.test';

    private const SUBJECT = 'portal-admin-immutable-id';

    private const TOKEN = 'sso-test-access-token-never-a-real-credential';

    private User $admin;

    private ?int $shopId = null;

    protected function beforeRefreshingDatabase(): void
    {
        $connection = DB::connection();
        if (! app()->environment('testing') || $connection->getDriverName() !== 'pgsql'
            || ! str_ends_with($connection->getDatabaseName(), '_test')) {
            throw new RuntimeException('SSO tests require a dedicated PostgreSQL database ending in _test.');
        }
    }

    protected function setUp(): void
    {
        parent::setUp();
        Http::preventStrayRequests();
        if (Schema::hasColumn('users', 'shop_id')) {
            $this->shopId = DB::table('shops')->insertGetId(['name' => 'SSO test shop', 'created_at' => now(), 'updated_at' => now()]);
        }
        $this->admin = $this->createUser();
        config([
            'sbm-sso.enabled' => true,
            'sbm-sso.issuer' => self::ISSUER,
            'sbm-sso.client_id' => 'test-client',
            'sbm-sso.client_secret' => 'test-client-secret',
            'sbm-sso.redirect_uri' => 'https://subsystem.example.test/auth/sso/callback',
            'sbm-sso.application_id' => 17,
            'sbm-sso.branch_id' => 29,
            'sbm-sso.local_shop_id' => $this->shopId,
            'sbm-sso.home_path' => '/',
            'sbm-sso.login_path' => '/login',
            'sanctum.stateful' => ['localhost'],
        ]);
        $this->withHeader('Origin', 'http://localhost');
    }

    public function test_callback_links_only_the_explicit_identity_and_stores_the_token_encrypted(): void
    {
        $link = $this->link();
        $this->identityProvider();
        $this->validProbe();

        $this->withSession($this->pending())->get('/auth/sso/callback?code=test-code&state=test-state')
            ->assertRedirect('/')->assertHeader('Cache-Control', 'no-store, private')
            ->assertSessionHas('sbm_sso.subject', self::SUBJECT)
            ->assertSessionHas('sbm_sso.link_id', $link->id)
            ->assertSessionHas('sbm_sso.user_id', $this->admin->id)
            ->assertSessionMissing('sbm_sso_pending')->assertSessionMissing('state')
            ->assertSessionMissing('code_verifier')->assertSessionMissing('openidconnect_nonce');
        $this->assertAuthenticatedAs($this->admin, 'web');
        $this->assertNotSame(self::TOKEN, session('sbm_sso.token'));
        $this->assertSame(self::TOKEN, decrypt(session('sbm_sso.token')));
        $this->assertNotEmpty(session('password_hash_web'));
        $this->get('/auth/sso/callback?code=test-code&state=test-state')->assertRedirect('/login?sso_error=1');
        Http::assertSentCount(1);
    }

    public function test_public_media_and_sso_configuration_never_write_authentication_cookies(): void
    {
        Route::get('/api/v1/login-background/media/stateless-test', fn (Request $request) => response()->json(['session_started' => $request->hasSession()]))->middleware('api');
        $this->getJson('/api/v1/login-background/media/stateless-test')->assertOk()
            ->assertJsonPath('session_started', false)->assertCookieMissing(config('session.cookie'))->assertCookieMissing('XSRF-TOKEN');
        $this->getJson('/auth/sso/config')->assertOk()->assertCookieMissing(config('session.cookie'))->assertCookieMissing('XSRF-TOKEN');
        $request = Request::create('/api/v1/login-background', 'POST');
        $request->headers->set('Origin', 'http://localhost');
        $this->assertTrue(PublicMediaStatefulRequests::fromFrontend($request));
        $request = Request::create('/api/v1/auth/me', 'GET');
        $request->headers->set('Origin', 'http://localhost');
        $this->assertTrue(PublicMediaStatefulRequests::fromFrontend($request));
    }

    public function test_matching_email_does_not_automatically_link_an_existing_administrator(): void
    {
        $this->identityProvider();
        $this->validProbe();
        $this->withSession($this->pending())->get('/auth/sso/callback?code=test-code')
            ->assertRedirect('/login?sso_error=1')->assertSessionMissing('sbm_sso');
        $this->assertGuest('web');
        $this->assertDatabaseCount('users', 1);
        $this->assertDatabaseCount('sso_account_links', 0);
    }

    public function test_callback_without_pending_login_never_uses_the_identity_provider(): void
    {
        $central = Mockery::mock(CentralSession::class)->makePartial();
        $central->shouldNotReceive('provider');
        $this->app->instance(CentralSession::class, $central);
        $this->get('/auth/sso/callback?code=replayed-code')->assertRedirect('/login?sso_error=1');
        $this->assertGuest('web');
        Http::assertNothingSent();
    }

    public function test_callback_consumes_pending_state_even_when_identity_validation_fails(): void
    {
        $provider = Mockery::mock(Provider::class);
        $provider->shouldReceive('user')->once()->andThrow(new RuntimeException('Invalid state or ID token'));
        $central = Mockery::mock(CentralSession::class)->makePartial();
        $central->shouldReceive('provider')->once()->andReturn($provider);
        $this->app->instance(CentralSession::class, $central);
        $this->withSession($this->pending())->get('/auth/sso/callback?code=bad-code')
            ->assertRedirect('/login?sso_error=1')->assertSessionMissing('sbm_sso_pending')
            ->assertSessionMissing('state')->assertSessionMissing('code_verifier')->assertSessionMissing('openidconnect_nonce');
        $this->get('/auth/sso/callback?code=bad-code')->assertRedirect('/login?sso_error=1');
        $this->assertGuest('web');
        Http::assertNothingSent();
    }

    public function test_expired_or_different_branch_pending_login_is_rejected_before_token_exchange(): void
    {
        $central = Mockery::mock(CentralSession::class)->makePartial();
        $central->shouldNotReceive('provider');
        $this->app->instance(CentralSession::class, $central);
        foreach ([['started_at' => time() - 301], ['branch_id' => 30], ['application_id' => 18]] as $change) {
            $pending = $this->pending();
            $pending['sbm_sso_pending'] = [...$pending['sbm_sso_pending'], ...$change];
            $this->withSession($pending)->get('/auth/sso/callback?code=test-code')
                ->assertRedirect('/login?sso_error=1')->assertSessionMissing('sbm_sso_pending');
        }
        $this->assertGuest('web');
        Http::assertNothingSent();
    }

    public function test_callback_rejects_a_probe_for_another_identity_or_branch(): void
    {
        $this->link();
        $this->identityProvider(2);
        Http::fake([self::ISSUER.'/api/sso/session' => Http::sequence()
            ->push([...$this->centralStatus(), 'sub' => 'different-subject'])
            ->push([...$this->centralStatus(), 'branch_id' => 30])]);
        foreach ([['sub' => 'different-subject'], ['branch_id' => 30]] as $change) {
            $this->withSession($this->pending())->get('/auth/sso/callback?code=test-code')
                ->assertRedirect('/login?sso_error=1')->assertSessionMissing('sbm_sso');
            $this->assertGuest('web');
        }
    }

    public function test_link_command_requires_an_active_administrator_and_explicit_replacement(): void
    {
        $this->artisan('sso:link', ['subject' => self::SUBJECT, 'user' => $this->admin->id])->assertSuccessful();
        $this->assertDatabaseHas('sso_account_links', ['subject' => self::SUBJECT, 'user_id' => $this->admin->id, 'branch_id' => 29]);
        $other = $this->createUser(['email' => 'second-admin@example.test']);
        $this->artisan('sso:link', ['subject' => self::SUBJECT, 'user' => $other->id])->assertFailed();
        $this->assertSame($this->admin->id, AccountLink::sole()->user_id);
        $other->update(['active' => false]);
        $this->artisan('sso:link', ['subject' => 'inactive', 'user' => $other->id])->assertFailed();
        $other->update(['active' => true, 'role' => 'technician']);
        $this->artisan('sso:link', ['subject' => 'technician', 'user' => $other->id])->assertFailed();
        $this->artisan('sso:link', ['subject' => self::SUBJECT, 'user' => $this->admin->id, '--remove' => true])->assertSuccessful();
        $this->assertDatabaseCount('sso_account_links', 0);
    }

    public function test_link_scope_and_local_account_changes_are_checked_on_every_request(): void
    {
        $link = $this->link();
        $central = app(CentralSession::class);
        $this->assertSame($this->admin->id, $central->localUser($link)->id);
        foreach ([['issuer' => 'https://other.example.test'], ['application_id' => 18], ['branch_id' => 30]] as $change) {
            $candidate = clone $link;
            $candidate->fill($change);
            $this->assertNull($central->localUser($candidate));
        }
        $this->admin->update(['active' => false]);
        $this->assertNull($central->localUser($link));
        $this->admin->update(['active' => true, 'role' => 'technician']);
        $this->assertNull($central->localUser($link));
        $this->admin->update(['role' => 'admin']);
        if ($this->shopId !== null) {
            config(['sbm-sso.local_shop_id' => $this->shopId + 1]);
            $this->assertNull($central->localUser($link));
            config(['sbm-sso.local_shop_id' => null]);
            $this->assertNull($central->localUser($link));
        } else {
            $link->local_shop_id = 77;
            $this->assertNull($central->localUser($link));
        }
    }

    public function test_sso_session_is_rechecked_with_the_portal_on_protected_requests(): void
    {
        $link = $this->link();
        $this->validProbe();
        $this->actingAs($this->admin, 'web')->withSession($this->ssoSession($link))
            ->getJson('/api/v1/auth/me')->assertOk();
        Http::assertSent(fn ($request) => $request->url() === self::ISSUER.'/api/sso/session'
            && $request->hasHeader('Authorization', 'Bearer '.self::TOKEN));
    }

    public function test_central_logout_revocation_rejects_and_clears_the_local_session(): void
    {
        $link = $this->link();
        Http::fake([self::ISSUER.'/api/sso/session' => Http::response([], 401)]);
        $this->actingAs($this->admin, 'web')->withSession($this->ssoSession($link))
            ->getJson('/api/v1/auth/me')->assertUnauthorized()->assertSessionMissing('sbm_sso');
        $this->assertGuest('web');
    }

    public function test_successful_probe_with_wrong_scope_also_expires_the_session(): void
    {
        $link = $this->link();
        Http::fake([self::ISSUER.'/api/sso/session' => Http::response([...$this->centralStatus(), 'application_id' => 18])]);
        $this->actingAs($this->admin, 'web')->withSession($this->ssoSession($link))
            ->getJson('/api/v1/auth/me')->assertUnauthorized()->assertSessionMissing('sbm_sso');
        $this->assertGuest('web');
    }

    public function test_deleted_link_and_disabled_local_admin_cannot_keep_an_sso_session(): void
    {
        $link = $this->link();
        $this->admin->update(['active' => false]);
        $this->actingAs($this->admin, 'web')->withSession($this->ssoSession($link))
            ->getJson('/api/v1/auth/me')->assertUnauthorized()->assertSessionMissing('sbm_sso');
        $this->admin->update(['active' => true]);
        $session = $this->ssoSession($link);
        $link->delete();
        $this->actingAs($this->admin, 'web')->withSession($session)
            ->getJson('/api/v1/auth/me')->assertUnauthorized()->assertSessionMissing('sbm_sso');
        Http::assertNothingSent();
    }

    public function test_portal_outage_denies_access_but_retains_session_for_a_retry(): void
    {
        $link = $this->link();
        Http::fake([self::ISSUER.'/api/sso/session' => Http::sequence()->push([], 503)->push($this->centralStatus())]);
        $this->actingAs($this->admin, 'web')->withSession($this->ssoSession($link))
            ->getJson('/api/v1/auth/me')->assertStatus(503)->assertSessionHas('sbm_sso');
        $this->getJson('/api/v1/auth/me')->assertOk();
    }

    public function test_portal_connection_failure_denies_access_without_destroying_the_session(): void
    {
        $link = $this->link();
        Http::fake(fn () => throw new ConnectionException('Portal unavailable'));
        $this->actingAs($this->admin, 'web')->withSession($this->ssoSession($link))
            ->getJson('/api/v1/auth/me')->assertStatus(503)->assertSessionHas('sbm_sso');
    }

    public function test_subsystem_logout_revokes_the_central_session_before_clearing_local_auth(): void
    {
        $link = $this->link();
        Http::fake([self::ISSUER.'/api/sso/logout' => Http::response([], 204)]);
        $this->actingAs($this->admin, 'web')->withSession($this->ssoSession($link))
            ->postJson('/api/v1/auth/logout')->assertSuccessful()->assertSessionMissing('sbm_sso');
        $this->assertGuest('web');
        Http::assertSent(fn ($request) => $request->method() === 'POST'
            && $request->url() === self::ISSUER.'/api/sso/logout'
            && $request->hasHeader('Authorization', 'Bearer '.self::TOKEN));
    }

    public function test_failed_central_logout_does_not_report_a_successful_global_logout(): void
    {
        $link = $this->link();
        Http::fake([self::ISSUER.'/api/sso/logout' => Http::response([], 503)]);
        $this->actingAs($this->admin, 'web')->withSession($this->ssoSession($link))
            ->postJson('/api/v1/auth/logout')->assertStatus(503)->assertSessionHas('sbm_sso');
        $this->assertAuthenticatedAs($this->admin, 'web');
    }

    public function test_ordinary_password_login_remains_independent_and_replaces_an_sso_session(): void
    {
        $link = $this->link();
        $this->actingAs($this->admin, 'web')->withSession($this->ssoSession($link))
            ->postJson('/api/v1/auth/login', ['email' => $this->admin->email, 'password' => 'sso-test-password'])
            ->assertOk()->assertSessionMissing('sbm_sso');
        $this->getJson('/api/v1/auth/me')->assertOk();
        Http::assertNothingSent();
    }

    public function test_password_session_does_not_depend_on_the_sso_configuration_or_portal(): void
    {
        config(['sbm-sso.enabled' => false]);
        $this->actingAs($this->admin, 'web')->getJson('/api/v1/auth/me')->assertOk();
        $this->get('/auth/sso/config')->assertOk()->assertJsonPath('enabled', false);
        $this->get('/auth/sso/redirect')->assertNotFound();
        Http::assertNothingSent();
    }

    public function test_disabled_sso_rejects_existing_sso_sessions(): void
    {
        $link = $this->link();
        config(['sbm-sso.enabled' => false]);
        $this->actingAs($this->admin, 'web')->withSession($this->ssoSession($link))
            ->getJson('/api/v1/auth/me')->assertUnauthorized()->assertSessionMissing('sbm_sso');
        Http::assertNothingSent();
    }

    public function test_sso_urls_reject_userinfo_queries_fragments_and_remote_plain_http(): void
    {
        $central = app(CentralSession::class);
        foreach (['https://user@portal.example.test', 'https://user:pass@portal.example.test',
            'https://portal.example.test?upstream=other', 'https://portal.example.test#fragment',
            'http://portal.example.test', 'http://localhost.attacker.example.test'] as $url) {
            try {
                $central->assertSafeUrl($url);
                $this->fail('Unsafe URL was accepted: '.$url);
            } catch (RuntimeException $exception) {
                $this->assertStringContainsString('HTTPS', $exception->getMessage());
            }
        }
        $central->assertSafeUrl('https://portal.example.test');
        $central->assertSafeUrl('http://127.0.0.1:8000');
        $central->assertSafeUrl('http://localhost:8000');
        $this->app->instance('env', 'production');
        $this->expectException(RuntimeException::class);
        $central->assertSafeUrl('http://127.0.0.1:8000');
    }

    private function createUser(array $attributes = []): User
    {
        return User::forceCreate([
            'name' => 'SSO test administrator', 'email' => 'admin@example.test',
            'password' => 'sso-test-password', 'role' => 'admin', 'active' => true,
            ...($this->shopId !== null ? ['shop_id' => $this->shopId] : []), ...$attributes,
        ]);
    }

    private function link(): AccountLink
    {
        return AccountLink::create([
            'issuer' => self::ISSUER, 'subject' => self::SUBJECT, 'application_id' => 17,
            'branch_id' => 29, 'user_id' => $this->admin->id, 'local_shop_id' => $this->shopId,
        ]);
    }

    private function pending(): array
    {
        return [
            'sbm_sso_pending' => ['application_id' => 17, 'branch_id' => 29, 'started_at' => time()],
            'state' => 'test-state', 'code_verifier' => 'test-verifier', 'openidconnect_nonce' => 'test-nonce',
        ];
    }

    private function identityProvider(int $calls = 1): void
    {
        $identity = (new Identity)->map(['id' => self::SUBJECT, 'email' => $this->admin->email])->setToken(self::TOKEN);
        $provider = Mockery::mock(Provider::class);
        $provider->shouldReceive('user')->times($calls)->andReturn($identity);
        $central = Mockery::mock(CentralSession::class)->makePartial();
        $central->shouldReceive('provider')->times($calls)->andReturn($provider);
        $this->app->instance(CentralSession::class, $central);
    }

    private function centralStatus(): array
    {
        return ['sub' => self::SUBJECT, 'application_id' => 17, 'branch_id' => 29];
    }

    private function validProbe(): void
    {
        Http::fake([self::ISSUER.'/api/sso/session' => Http::response($this->centralStatus())]);
    }

    private function ssoSession(AccountLink $link): array
    {
        return ['sbm_sso' => [
            'subject' => self::SUBJECT, 'link_id' => $link->id, 'user_id' => $this->admin->id,
            'token' => encrypt(self::TOKEN), 'issuer' => self::ISSUER, 'application_id' => 17, 'branch_id' => 29,
        ]];
    }
}
