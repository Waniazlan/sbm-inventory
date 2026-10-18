<?php

namespace App\Http\Controllers;

use App\Http\Requests\LoginBackgroundRequest;
use App\Models\AuditLog;
use App\Models\LoginBackground;
use App\Services\LoginBackgroundMedia;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;
use Throwable;

class LoginBackgroundController
{
    public function show(): JsonResponse
    {
        return $this->configuration(LoginBackground::findOrFail(1));
    }

    public function media(Request $request, string $token): Response
    {
        $background = LoginBackground::whereKey(1)->where('token', $token)->firstOrFail();

        return app(LoginBackgroundMedia::class)->response($background, $request);
    }

    public function store(LoginBackgroundRequest $request): JsonResponse
    {
        $diskName = config('filesystems.login_background_disk', 'rustfs');
        if (config('filesystems.disks.'.$diskName.'.driver') === 's3') {
            foreach (['endpoint', 'bucket', 'region', 'key', 'secret'] as $setting) {
                abort_unless(filled(config('filesystems.disks.'.$diskName.'.'.$setting)), 503, 'Background storage is not configured. Please contact your administrator.');
            }
        }
        $file = $request->file('file');
        $mimeType = $file->getMimeType();
        $token = (string) Str::uuid();
        $filename = $token.'.'.LoginBackgroundRequest::MIME_EXTENSIONS[$mimeType];
        $path = 'login-backgrounds/'.$filename;

        try {
            $stored = Storage::disk($diskName)->putFileAs('login-backgrounds', $file, $filename, ['visibility' => 'private', 'ContentType' => $mimeType]);
            abort_unless($stored, 503, 'Unable to save the login background. Please try again.');

            $background = DB::transaction(function () use ($file, $mimeType, $token, $path, $diskName) {
                $background = LoginBackground::whereKey(1)->lockForUpdate()->firstOrFail();
                $previousPath = $background->path;
                $previousDisk = $background->disk ?: 'local';
                $background->forceFill([
                    'token' => $token,
                    'path' => $path,
                    'disk' => $diskName,
                    'kind' => str_starts_with($mimeType, 'image/') ? 'image' : 'video',
                    'name' => mb_substr($file->getClientOriginalName(), 0, 255),
                    'mime_type' => $mimeType,
                    'size' => $file->getSize(),
                ])->save();

                AuditLog::create(['actor_id' => auth()->id(), 'source' => 'web', 'action' => 'settings.login_background_updated', 'target' => 'login_background:1', 'details' => ['name' => $background->name, 'kind' => $background->kind], 'created_at' => now()]);
                DB::afterCommit(fn () => $this->removeFile($previousPath, $previousDisk));

                return $background;
            });
        } catch (Throwable $error) {
            $this->removeFile($path, $diskName);
            report($error);
            abort(503, 'Unable to save the login background. Please try again.');
        }

        return $this->configuration($background);
    }

    public function destroy(): JsonResponse
    {
        $background = DB::transaction(function () {
            $background = LoginBackground::whereKey(1)->lockForUpdate()->firstOrFail();
            $previousPath = $background->path;
            $previousDisk = $background->disk ?: 'local';
            $background->forceFill([
                'token' => null,
                'path' => null,
                'disk' => null,
                'kind' => null,
                'name' => null,
                'mime_type' => null,
                'size' => null,
            ])->save();

            AuditLog::create(['actor_id' => auth()->id(), 'source' => 'web', 'action' => 'settings.login_background_reset', 'target' => 'login_background:1', 'details' => [], 'created_at' => now()]);
            DB::afterCommit(fn () => $this->removeFile($previousPath, $previousDisk));

            return $background;
        });

        return $this->configuration($background);
    }

    private function configuration(LoginBackground $background): JsonResponse
    {
        $data = $background->path && $background->token
            ? [
                'kind' => $background->kind,
                'name' => $background->name,
                'url' => route('login-background.media', ['token' => $background->token], false),
            ]
            : null;

        return response()->json(['data' => $data])->header('Cache-Control', 'no-store');
    }

    private function removeFile(?string $path, string $diskName): void
    {
        if (! $path) {
            return;
        }

        try {
            if (! Storage::disk($diskName)->delete($path)) {
                report(new \RuntimeException('Unable to remove an unused login background file.'));
            }
        } catch (Throwable $error) {
            report($error);
        }
    }
}
