<?php

namespace Tests\Feature;

use App\Models\Category;
use App\Models\LoginBackground;
use App\Models\User;
use Aws\Command;
use Aws\MockHandler;
use Aws\Result;
use Aws\S3\Exception\S3Exception;
use Aws\S3\S3Client;
use GuzzleHttp\Psr7\Response as S3Response;
use GuzzleHttp\Psr7\Utils;
use Illuminate\Filesystem\AwsS3V3Adapter;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use League\Flysystem\AwsS3V3\AwsS3V3Adapter as FlysystemS3Adapter;
use League\Flysystem\Filesystem;
use Tests\TestCase;

class LoginBackgroundTest extends TestCase
{
    use DatabaseMigrations;

    protected function setUp(): void
    {
        parent::setUp();
        $this->assertSame('sbm_inventory_test', config('database.connections.pgsql.database'));
        config([
            'filesystems.login_background_disk' => 'rustfs',
            'filesystems.disks.rustfs.key' => 'test-key',
            'filesystems.disks.rustfs.secret' => 'test-secret',
            'filesystems.disks.rustfs.bucket' => 'test-backgrounds',
            'filesystems.disks.rustfs.endpoint' => 'https://rustfs.test',
        ]);
        Storage::fake('local');
        Storage::fake('rustfs');
    }

    private function manager(array $attributes = []): User
    {
        return User::create(['name' => 'Background admin', 'email' => 'background@example.test', 'password' => 'background-test-password', 'role' => 'admin', 'active' => true, ...$attributes]);
    }

    public function test_public_configuration_exposes_only_the_current_media(): void
    {
        $this->getJson('/api/v1/login-background')->assertOk()->assertExactJson(['data' => null])->assertHeader('Cache-Control', 'no-store, private');
        $token = (string) Str::uuid();
        Storage::disk('rustfs')->put('login-backgrounds/'.$token.'.png', 'image bytes');
        LoginBackground::findOrFail(1)->forceFill(['path' => 'login-backgrounds/'.$token.'.png', 'token' => $token, 'disk' => 'rustfs', 'kind' => 'image', 'name' => 'shop.png', 'mime_type' => 'image/png'])->save();
        $this->getJson('/api/v1/login-background')->assertOk()->assertExactJson(['data' => ['kind' => 'image', 'name' => 'shop.png', 'url' => '/api/v1/login-background/media/'.$token]]);
        $this->get('/api/v1/login-background/media/'.$token)->assertOk()->assertHeader('Content-Type', 'image/png')->assertHeader('X-Content-Type-Options', 'nosniff');
        $this->get('/api/v1/login-background/media/not-a-token')->assertNotFound();
    }

    public function test_guests_cannot_change_the_login_background(): void
    {
        $this->postJson('/api/v1/settings/login-background', ['file' => UploadedFile::fake()->image('shop.png')])->assertUnauthorized();
        $this->deleteJson('/api/v1/settings/login-background')->assertUnauthorized();
        Storage::disk('rustfs')->assertDirectoryEmpty('login-backgrounds');
    }

    public function test_staff_without_settings_permission_cannot_change_background(): void
    {
        $this->actingAs($this->manager(['role' => 'technician']));
        $this->postJson('/api/v1/settings/login-background', ['file' => UploadedFile::fake()->image('shop.png')])->assertForbidden();
        $this->deleteJson('/api/v1/settings/login-background')->assertForbidden();
    }

    public function test_inactive_staff_cannot_change_background(): void
    {
        $this->actingAs($this->manager(['active' => false]));
        $this->postJson('/api/v1/settings/login-background', ['file' => UploadedFile::fake()->image('shop.png')])->assertForbidden();
        $this->deleteJson('/api/v1/settings/login-background')->assertForbidden();
    }

    public function test_admin_can_upload_and_reset(): void
    {
        $this->actingAs($this->manager());
        $data = $this->postJson('/api/v1/settings/login-background', ['file' => UploadedFile::fake()->image('shop.png')])->assertOk()->assertJsonPath('data.kind', 'image')->json('data');
        $this->assertSame('shop.png', $data['name']);
        $this->assertDatabaseHas('login_backgrounds', ['disk' => 'rustfs', 'name' => 'shop.png']);
        $this->assertEmpty(Storage::disk('local')->allFiles());
        $this->get($data['url'])->assertOk();
        $this->deleteJson('/api/v1/settings/login-background')->assertOk()->assertExactJson(['data' => null]);
    }

    public function test_replacement_removes_the_previous_file_and_invalidates_its_url(): void
    {
        $this->actingAs($this->manager());
        $previous = $this->postJson('/api/v1/settings/login-background', ['file' => UploadedFile::fake()->image('first.png')])->assertOk()->json('data.url');
        $oldPath = LoginBackground::findOrFail(1)->path;
        $current = $this->postJson('/api/v1/settings/login-background', ['file' => UploadedFile::fake()->image('second.jpg')])->assertOk()->json('data.url');
        $this->assertNotSame($previous, $current);
        Storage::disk('rustfs')->assertMissing($oldPath);
        $this->assertCount(1, Storage::disk('rustfs')->allFiles('login-backgrounds'));
        $this->get($previous)->assertNotFound();
        $this->get($current)->assertOk();
        $this->assertDatabaseCount('audit_logs', 2);
        $this->assertDatabaseHas('audit_logs', ['action' => 'settings.login_background_updated']);
    }

    public function test_reset_preserves_other_settings_and_removes_file(): void
    {
        Category::create(['name' => 'Existing category']);
        $this->actingAs($this->manager());
        $url = $this->postJson('/api/v1/settings/login-background', ['file' => UploadedFile::fake()->image('shop.png')])->assertOk()->json('data.url');
        $this->deleteJson('/api/v1/settings/login-background')->assertOk()->assertExactJson(['data' => null]);
        $this->getJson('/api/v1/login-background')->assertOk()->assertExactJson(['data' => null]);
        $this->get($url)->assertNotFound();
        Storage::disk('rustfs')->assertDirectoryEmpty('login-backgrounds');
        $this->assertDatabaseHas('audit_logs', ['action' => 'settings.login_background_reset']);
        $this->assertDatabaseHas('categories', ['name' => 'Existing category']);
        $this->deleteJson('/api/v1/settings/login-background')->assertOk();
    }

    public function test_invalid_uploads_preserve_the_saved_background(): void
    {
        $this->actingAs($this->manager());
        $current = $this->postJson('/api/v1/settings/login-background', ['file' => UploadedFile::fake()->image('shop.png')])->assertOk()->json();
        foreach ([
            UploadedFile::fake()->createWithContent('fake.png', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')->mimeType('image/svg+xml'),
            UploadedFile::fake()->createWithContent('empty.png', ''),
            UploadedFile::fake()->image('large.png')->size(10241),
            UploadedFile::fake()->createWithContent('fake.mp4', 'this is not video content')->mimeType('text/plain'),
            UploadedFile::fake()->create('large.mp4', 51201, 'video/mp4'),
        ] as $file) {
            $this->postJson('/api/v1/settings/login-background', ['file' => $file])->assertUnprocessable()->assertJsonValidationErrors('file');
            $this->getJson('/api/v1/login-background')->assertExactJson($current);
        }
        $this->assertCount(1, Storage::disk('rustfs')->allFiles('login-backgrounds'));
    }

    public function test_video_uploads_keep_their_media_type(): void
    {
        $this->actingAs($this->manager());
        foreach (['mp4' => 'video/mp4', 'webm' => 'video/webm'] as $extension => $mime) {
            $url = $this->postJson('/api/v1/settings/login-background', ['file' => UploadedFile::fake()->create('video.'.$extension, 1024, $mime)])->assertOk()->assertJsonPath('data.kind', 'video')->json('data.url');
            $this->get($url)->assertOk()->assertHeader('Content-Type', $mime);
        }
    }

    public function test_missing_media_returns_not_found_so_the_login_can_fall_back(): void
    {
        $token = (string) Str::uuid();
        LoginBackground::findOrFail(1)->forceFill(['path' => 'login-backgrounds/missing.png', 'token' => $token, 'kind' => 'image', 'name' => 'missing.png'])->save();
        $this->getJson('/api/v1/login-background')->assertOk()->assertJsonPath('data.url', '/api/v1/login-background/media/'.$token);
        $this->getJson('/api/v1/login-background/media/'.$token)->assertNotFound();
    }

    public function test_storage_failure_preserves_the_previous_configuration(): void
    {
        $this->actingAs($this->manager());
        $current = $this->postJson('/api/v1/settings/login-background', ['file' => UploadedFile::fake()->image('shop.png')])->assertOk()->json();
        $disk = Storage::disk('rustfs');
        $unwritable = \Mockery::mock($disk)->makePartial();
        $unwritable->shouldReceive('putFileAs')->once()->andReturn(false);
        Storage::shouldReceive('disk')->with('rustfs')->andReturn($unwritable);
        $this->postJson('/api/v1/settings/login-background', ['file' => UploadedFile::fake()->image('replacement.png')])->assertStatus(503);
        $this->getJson('/api/v1/login-background')->assertExactJson($current);
    }

    public function test_existing_local_background_is_preserved_and_replaced_on_the_right_disk(): void
    {
        $token = (string) Str::uuid();
        $path = 'login-backgrounds/legacy.png';
        Storage::disk('local')->put($path, 'legacy image');
        LoginBackground::findOrFail(1)->forceFill(['path' => $path, 'disk' => 'local', 'token' => $token, 'kind' => 'image', 'name' => 'legacy.png', 'mime_type' => 'image/png'])->save();
        $this->get('/api/v1/login-background/media/'.$token)->assertOk();
        $this->actingAs($this->manager());
        $this->postJson('/api/v1/settings/login-background', ['file' => UploadedFile::fake()->image('new.png')])->assertOk();
        Storage::disk('local')->assertMissing($path);
        $this->assertDatabaseHas('login_backgrounds', ['disk' => 'rustfs', 'name' => 'new.png']);
        $this->assertCount(1, Storage::disk('rustfs')->allFiles('login-backgrounds'));
    }

    public function test_saved_disk_is_used_even_after_upload_configuration_changes(): void
    {
        $this->actingAs($this->manager());
        $url = $this->postJson('/api/v1/settings/login-background', ['file' => UploadedFile::fake()->image('rustfs.png')])->assertOk()->json('data.url');
        config(['filesystems.login_background_disk' => 'local', 'filesystems.default' => 'local']);
        $this->get($url)->assertOk();
        $this->deleteJson('/api/v1/settings/login-background')->assertOk();
        Storage::disk('rustfs')->assertDirectoryEmpty('login-backgrounds');
        $this->assertEmpty(Storage::disk('local')->allFiles());
    }

    public function test_missing_rustfs_settings_fail_without_saving_locally(): void
    {
        $this->actingAs($this->manager());
        $current = $this->postJson('/api/v1/settings/login-background', ['file' => UploadedFile::fake()->image('saved.png')])->assertOk()->json();
        config(['filesystems.disks.rustfs.key' => null]);
        $this->postJson('/api/v1/settings/login-background', ['file' => UploadedFile::fake()->image('replacement.png')])->assertStatus(503);
        $this->getJson('/api/v1/login-background')->assertExactJson($current);
        $this->assertEmpty(Storage::disk('local')->allFiles());
        $this->assertCount(1, Storage::disk('rustfs')->allFiles('login-backgrounds'));
    }

    private function remoteDisk(array $results): MockHandler
    {
        $handler = new MockHandler($results);
        $client = new S3Client(['version' => 'latest', 'region' => 'us-east-1', 'endpoint' => 'https://rustfs.test', 'credentials' => ['key' => 'test-key', 'secret' => 'test-secret'], 'use_path_style_endpoint' => true, 'handler' => $handler, 'retries' => 0]);
        $adapter = new FlysystemS3Adapter($client, 'test-backgrounds', 'sales');
        Storage::set('rustfs', new AwsS3V3Adapter(new Filesystem($adapter), $adapter, ['bucket' => 'test-backgrounds', 'root' => 'sales'], $client));

        return $handler;
    }

    private function remoteBackground(): LoginBackground
    {
        $background = LoginBackground::findOrFail(1);
        $background->forceFill(['disk' => 'rustfs', 'path' => 'login-backgrounds/video.webm', 'token' => (string) Str::uuid(), 'kind' => 'video', 'name' => 'video.webm', 'mime_type' => 'video/webm', 'size' => 10])->save();

        return $background;
    }

    public function test_private_s3_media_is_streamed_without_exposing_storage_urls(): void
    {
        $background = $this->remoteBackground();
        $handler = $this->remoteDisk([new Result(['Body' => Utils::streamFor('0123456789'), 'ContentLength' => 10])]);
        $this->get('/api/v1/login-background/media/'.$background->token)->assertOk()->assertHeader('Content-Length', '10')->assertHeader('Content-Type', 'video/webm')->assertHeader('Accept-Ranges', 'bytes')->assertHeaderMissing('Location')->assertStreamedContent('0123456789');
        $command = $handler->getLastCommand();
        $this->assertSame('GetObject', $command->getName());
        $this->assertSame('test-backgrounds', $command['Bucket']);
        $this->assertSame('sales/login-backgrounds/video.webm', $command['Key']);
        $this->assertTrue($command['@http']['stream']);
    }

    public function test_private_video_byte_ranges_are_forwarded_to_s3(): void
    {
        $background = $this->remoteBackground();
        foreach ([['bytes=2-6', '23456', 'bytes 2-6/10'], ['bytes=-3', '789', 'bytes 7-9/10'], ['bytes=7-', '789', 'bytes 7-9/10']] as [$range, $body, $contentRange]) {
            $handler = $this->remoteDisk([new Result(['Body' => Utils::streamFor($body), 'ContentLength' => strlen($body), 'ContentRange' => $contentRange])]);
            $this->withHeader('Range', $range)->get('/api/v1/login-background/media/'.$background->token)->assertStatus(206)->assertHeader('Content-Range', $contentRange)->assertStreamedContent($body);
            $this->assertSame($range, $handler->getLastCommand()['Range']);
        }
    }

    public function test_stale_if_range_requests_receive_the_full_object(): void
    {
        $background = $this->remoteBackground();
        $handler = $this->remoteDisk([new Result(['Body' => Utils::streamFor('0123456789'), 'ContentLength' => 10])]);
        $this->withHeaders(['Range' => 'bytes=2-6', 'If-Range' => '"stale-token"'])->get('/api/v1/login-background/media/'.$background->token)->assertOk()->assertStreamedContent('0123456789');
        $this->assertNull($handler->getLastCommand()['Range']);
    }

    public function test_s3_invalid_ranges_return_the_object_size(): void
    {
        $background = $this->remoteBackground();
        $this->remoteDisk([new S3Exception('Invalid range', new Command('GetObject'), ['response' => new S3Response(416), 'code' => 'InvalidRange'])]);
        $this->withHeader('Range', 'bytes=100-')->get('/api/v1/login-background/media/'.$background->token)->assertStatus(416)->assertHeader('Content-Range', 'bytes */10');
    }

    public function test_s3_missing_objects_and_storage_outages_have_safe_responses(): void
    {
        $background = $this->remoteBackground();
        $this->remoteDisk([new S3Exception('Missing', new Command('GetObject'), ['response' => new S3Response(404), 'code' => 'NoSuchKey'])]);
        $this->getJson('/api/v1/login-background/media/'.$background->token)->assertNotFound();
        $this->remoteDisk([new S3Exception('Storage failure', new Command('GetObject'), ['response' => new S3Response(503), 'code' => 'ServiceUnavailable'])]);
        $this->getJson('/api/v1/login-background/media/'.$background->token)->assertStatus(503)->assertJsonPath('message', 'The login background is temporarily unavailable.');
    }
}
