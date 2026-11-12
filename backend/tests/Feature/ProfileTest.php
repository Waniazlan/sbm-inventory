<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class ProfileTest extends TestCase
{
    use RefreshDatabase;

    private function user(array $attributes = []): User
    {
        return User::create(array_replace([
            'name' => 'Profile user', 'email' => 'profile@example.test',
            'password' => 'original-password', 'role' => 'technician', 'active' => true,
        ], $attributes));
    }

    public function test_profile_updates_require_an_active_authenticated_account(): void
    {
        $this->putJson('/api/v1/auth/profile', ['name' => 'Changed'])->assertUnauthorized();
        $this->putJson('/api/v1/auth/password', [])->assertUnauthorized();
        $this->actingAs($this->user(['active' => false]));
        $this->putJson('/api/v1/auth/profile', ['name' => 'Changed'])->assertForbidden();
        $this->putJson('/api/v1/auth/password', [])->assertForbidden();
    }

    public function test_both_roles_can_update_only_their_own_name(): void
    {
        $other = $this->user(['email' => 'other@example.test']);
        foreach (['technician', 'admin'] as $role) {
            $user = $this->user(['email' => $role.'@example.test', 'role' => $role]);
            $this->actingAs($user)->putJson('/api/v1/auth/profile', [
                'name' => '  Updated name  ', 'id' => $other->id, 'email' => 'changed@example.test',
                'role' => 'admin', 'active' => false, 'password' => 'injected-password',
            ])->assertOk()->assertJsonPath('name', 'Updated name')->assertJsonPath('id', $user->id)
                ->assertJsonPath('email', $role.'@example.test')->assertJsonPath('role', $role)
                ->assertJsonPath('active', true)->assertJsonMissingPath('password')->assertJsonMissingPath('remember_token');
            $this->getJson('/api/v1/auth/me')->assertOk()->assertJsonPath('name', 'Updated name');
            $this->assertSame('Updated name', $user->fresh()->name);
            $this->assertTrue(Hash::check('original-password', $user->fresh()->password));
        }
        $this->assertSame('Profile user', $other->fresh()->name);
    }

    public function test_invalid_names_do_not_change_the_account(): void
    {
        $user = $this->user();
        $this->actingAs($user);
        foreach (['', '   ', str_repeat('a', 151)] as $name) {
            $this->putJson('/api/v1/auth/profile', ['name' => $name])->assertUnprocessable()->assertJsonValidationErrors('name');
        }
        $this->assertSame('Profile user', $user->fresh()->name);
    }

    public function test_password_change_checks_current_password_confirmation_and_length(): void
    {
        $user = $this->user();
        $this->actingAs($user);
        $valid = ['current_password' => 'original-password', 'password' => 'replacement-password', 'password_confirmation' => 'replacement-password'];
        foreach ([
            ['current_password' => 'incorrect'],
            ['password_confirmation' => 'does-not-match'],
            ['password_confirmation' => null],
            ['password' => 'short', 'password_confirmation' => 'short'],
            ['password' => str_repeat('x', 201), 'password_confirmation' => str_repeat('x', 201)],
        ] as $change) {
            $this->putJson('/api/v1/auth/password', array_replace($valid, $change))->assertUnprocessable();
            $this->assertTrue(Hash::check('original-password', $user->fresh()->password));
        }
    }

    public function test_password_change_persists_hash_and_keeps_the_current_session_usable(): void
    {
        $user = $this->user();
        $other = $this->user(['email' => 'other@example.test']);
        $this->withHeader('Origin', 'http://localhost');
        config(['sanctum.stateful' => ['localhost']]);
        $this->postJson('/api/v1/auth/login', ['email' => $user->email, 'password' => 'original-password'])->assertOk();
        $this->putJson('/api/v1/auth/password', [
            'current_password' => 'original-password', 'password' => 'replacement-password',
            'password_confirmation' => 'replacement-password', 'id' => $other->id, 'role' => 'admin',
        ])->assertNoContent();
        $this->getJson('/api/v1/auth/me')->assertOk()->assertJsonPath('id', $user->id);
        $this->assertTrue(Hash::check('replacement-password', $user->fresh()->password));
        $this->assertFalse(Hash::check('original-password', $user->fresh()->password));
        $this->assertTrue(Hash::check('original-password', $other->fresh()->password));
        $this->assertSame('technician', $user->fresh()->role);
        $this->assertFalse(Auth::guard('web')->validate(['email' => $user->email, 'password' => 'original-password']));
        $this->assertTrue(Auth::guard('web')->validate(['email' => $user->email, 'password' => 'replacement-password']));
    }
}
