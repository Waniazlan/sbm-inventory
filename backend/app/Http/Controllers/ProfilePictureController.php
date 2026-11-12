<?php

namespace App\Http\Controllers;

use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Throwable;

class ProfilePictureController
{
    public function store(Request $request)
    {
        $request->validate(['picture' => 'required|image|mimes:jpg,jpeg,png,webp|max:5120|dimensions:max_width=4096,max_height=4096']);
        $file = $request->file('picture');
        $diskName = config('filesystems.profile_picture_disk', 'rustfs');
        $directory = 'profile-pictures/'.$request->user()->id;
        $filename = Str::uuid().'.'.$file->extension();
        $path = $directory.'/'.$filename;

        try {
            $stored = Storage::disk($diskName)->putFileAs($directory, $file, $filename, ['visibility' => 'private', 'ContentType' => $file->getMimeType()]);
            if (! $stored) {
                throw new \RuntimeException('Profile picture could not be stored.');
            }
            $user = DB::transaction(function () use ($request, $path, $diskName) {
                $user = User::whereKey($request->user()->id)->lockForUpdate()->firstOrFail();
                $previousPath = $user->avatar_path;
                $previousDisk = $user->avatar_disk;
                $user->forceFill(['avatar_path' => $path, 'avatar_disk' => $diskName])->save();
                DB::afterCommit(fn () => $this->removeFile($previousPath, $previousDisk));

                return $user;
            });
        } catch (Throwable $error) {
            $this->removeFile($path, $diskName);
            report($error);
            abort(503, 'Unable to save your profile picture. Please try again.');
        }

        $request->user()->setRawAttributes($user->getAttributes(), true);

        return $request->user();
    }

    public function destroy(Request $request)
    {
        $user = DB::transaction(function () use ($request) {
            $user = User::whereKey($request->user()->id)->lockForUpdate()->firstOrFail();
            $previousPath = $user->avatar_path;
            $previousDisk = $user->avatar_disk;
            $user->forceFill(['avatar_path' => null, 'avatar_disk' => null])->save();
            DB::afterCommit(fn () => $this->removeFile($previousPath, $previousDisk));

            return $user;
        });
        $request->user()->setRawAttributes($user->getAttributes(), true);

        return $request->user();
    }

    public function show(Request $request, string $token)
    {
        $user = $request->user();
        abort_unless($user->avatar_path && pathinfo($user->avatar_path, PATHINFO_FILENAME) === $token, 404);
        try {
            $disk = Storage::disk($user->avatar_disk);
            abort_unless($disk->exists($user->avatar_path), 404);
            $stream = $disk->readStream($user->avatar_path);
            if (! is_resource($stream)) {
                throw new \RuntimeException('Profile picture could not be read.');
            }
        } catch (HttpException $error) {
            throw $error;
        } catch (Throwable $error) {
            report($error);
            abort(503, 'Your profile picture is temporarily unavailable.');
        }

        $mime = match (pathinfo($user->avatar_path, PATHINFO_EXTENSION)) {
            'jpg', 'jpeg' => 'image/jpeg',
            'webp' => 'image/webp',
            default => 'image/png',
        };

        return response()->stream(function () use ($stream) {
            try {
                fpassthru($stream);
            } finally {
                fclose($stream);
            }
        }, 200, ['Content-Type' => $mime, 'X-Content-Type-Options' => 'nosniff', 'Cache-Control' => 'private, no-store']);
    }

    private function removeFile(?string $path, ?string $diskName): void
    {
        if (! $path || ! $diskName) {
            return;
        }
        try {
            if (! Storage::disk($diskName)->delete($path)) {
                report(new \RuntimeException('Unable to remove an unused profile picture.'));
            }
        } catch (Throwable $error) {
            report($error);
        }
    }
}
