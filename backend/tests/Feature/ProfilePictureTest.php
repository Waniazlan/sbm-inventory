<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class ProfilePictureTest extends TestCase
{
    use DatabaseMigrations;

    protected function setUp(): void
    {
        parent::setUp();
        $this->assertSame('sbm_inventory_test', config('database.connections.pgsql.database'));
        config(['filesystems.profile_picture_disk' => 'rustfs']);
        Storage::fake('rustfs');
    }

    private function user(array $attributes = []): User
    {
        return User::create(array_replace([
            'name' => 'Picture user', 'email' => 'picture@example.test',
            'password' => 'test-password-123', 'role' => 'technician', 'active' => true,
        ], $attributes));
    }

    private function upload(string $filename = 'portrait.png')
    {
        return $this->postJson('/api/v1/auth/profile/picture', ['picture' => UploadedFile::fake()->image($filename, 200, 200)]);
    }

    public function test_picture_routes_require_an_active_authenticated_user(): void
    {
        $url = '/api/v1/auth/profile/picture/12345678-1234-4123-8123-123456789abc';
        $this->upload()->assertUnauthorized();
        $this->deleteJson('/api/v1/auth/profile/picture')->assertUnauthorized();
        $this->getJson($url)->assertUnauthorized();
        $this->actingAs($this->user(['active' => false]));
        $this->upload()->assertForbidden();
        $this->deleteJson('/api/v1/auth/profile/picture')->assertForbidden();
        $this->getJson($url)->assertForbidden();
    }

    public function test_both_roles_can_save_and_read_their_picture_without_exposing_storage_paths(): void
    {
        foreach (['admin', 'technician'] as $role) {
            $user = $this->user(['email' => $role.'@example.test', 'role' => $role]);
            $this->actingAs($user);
            $file = UploadedFile::fake()->image('portrait.jpg', 200, 200);
            $url = $this->postJson('/api/v1/auth/profile/picture', ['picture' => $file])->assertOk()
                ->assertJsonMissingPath('avatar_path')->assertJsonMissingPath('avatar_disk')->json('avatar_url');
            $user->refresh();
            $this->assertSame('rustfs', $user->avatar_disk);
            Storage::disk('rustfs')->assertExists($user->avatar_path);
            $this->assertStringStartsWith('profile-pictures/'.$user->id.'/', $user->avatar_path);
            $this->get($url)->assertOk()->assertHeader('Content-Type', 'image/jpeg')
                ->assertHeader('Cache-Control', 'no-store, private')->assertHeader('X-Content-Type-Options', 'nosniff')
                ->assertStreamedContent(file_get_contents($file->getRealPath()));
            $this->getJson('/api/v1/auth/me')->assertOk()->assertJsonPath('avatar_url', $url);
        }
    }

    public function test_replacement_and_removal_clean_files_and_invalidate_old_urls(): void
    {
        $user = $this->user();
        $this->actingAs($user);
        $first = $this->upload()->assertOk()->json('avatar_url');
        $firstPath = $user->fresh()->avatar_path;
        $second = $this->upload('replacement.jpg')->assertOk()->json('avatar_url');
        $this->assertNotSame($first, $second);
        Storage::disk('rustfs')->assertMissing($firstPath);
        $this->getJson($first)->assertNotFound();
        $this->get($second)->assertOk();
        $this->assertCount(1, Storage::disk('rustfs')->allFiles());
        $this->deleteJson('/api/v1/auth/profile/picture')->assertOk()->assertJsonPath('avatar_url', null);
        Storage::disk('rustfs')->assertDirectoryEmpty('profile-pictures');
        $this->getJson($second)->assertNotFound();
        $this->getJson('/api/v1/auth/me')->assertJsonPath('avatar_url', null);
        $this->deleteJson('/api/v1/auth/profile/picture')->assertOk();
    }

    public function test_users_cannot_read_overwrite_or_remove_someone_elses_picture(): void
    {
        $owner = $this->user();
        $this->actingAs($owner);
        $ownerUrl = $this->upload()->assertOk()->json('avatar_url');
        $ownerPath = $owner->fresh()->avatar_path;
        $other = $this->user(['email' => 'other@example.test']);
        $this->actingAs($other);
        $this->getJson($ownerUrl)->assertNotFound();
        $this->postJson('/api/v1/auth/profile/picture', ['picture' => UploadedFile::fake()->image('other.png'), 'user_id' => $owner->id, 'id' => $owner->id])->assertOk()->assertJsonPath('id', $other->id);
        $this->deleteJson('/api/v1/auth/profile/picture', ['user_id' => $owner->id])->assertOk();
        $this->assertSame($ownerPath, $owner->fresh()->avatar_path);
        Storage::disk('rustfs')->assertExists($ownerPath);
        $this->putJson('/api/v1/auth/profile', ['name' => 'Changed', 'avatar_path' => $ownerPath, 'avatar_disk' => 'rustfs'])->assertOk()->assertJsonPath('avatar_url', null);
    }

    public function test_invalid_uploads_preserve_the_current_picture(): void
    {
        $user = $this->user();
        $this->actingAs($user);
        $url = $this->upload()->assertOk()->json('avatar_url');
        foreach ([
            UploadedFile::fake()->createWithContent('fake.png', 'not an image'),
            UploadedFile::fake()->createWithContent('vector.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"></svg>'),
            UploadedFile::fake()->image('large.png')->size(5121),
            UploadedFile::fake()->image('wide.png', 4097, 1),
        ] as $file) {
            $this->postJson('/api/v1/auth/profile/picture', ['picture' => $file])->assertUnprocessable()->assertJsonValidationErrors('picture');
            $this->assertSame($url, $user->fresh()->avatar_url);
        }
        $this->assertCount(1, Storage::disk('rustfs')->allFiles());
    }

    public function test_failed_storage_preserves_the_current_picture(): void
    {
        $user = $this->user();
        $this->actingAs($user);
        $url = $this->upload()->assertOk()->json('avatar_url');
        $disk = Storage::disk('rustfs');
        $failedDisk = \Mockery::mock($disk)->makePartial();
        $failedDisk->shouldReceive('putFileAs')->once()->andReturn(false);
        Storage::shouldReceive('disk')->with('rustfs')->andReturn($failedDisk);
        $this->upload()->assertStatus(503);
        $this->assertSame($url, $user->fresh()->avatar_url);
        $disk->assertExists($user->fresh()->avatar_path);
    }
}
