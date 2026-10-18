<?php

namespace App\Services;

use App\Models\LoginBackground;
use Aws\S3\Exception\S3Exception;
use Illuminate\Filesystem\AwsS3V3Adapter;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Throwable;

class LoginBackgroundMedia
{
    public function response(LoginBackground $background, Request $request): Response
    {
        abort_unless($background->path, 404);
        $headers = [
            'Content-Type' => $background->mime_type,
            'X-Content-Type-Options' => 'nosniff',
            'Cache-Control' => 'public, max-age=31536000, immutable',
        ];

        try {
            $disk = Storage::disk($background->disk ?: 'local');
            if (! $disk instanceof AwsS3V3Adapter) {
                abort_unless($disk->exists($background->path), 404);

                return response()->file($disk->path($background->path), $headers);
            }

            // Proxy private S3 objects through the same public token route. The browser
            // never needs bucket access, a signed URL, or a network route to RustFS.
            $arguments = [
                'Bucket' => $disk->getConfig()['bucket'],
                'Key' => $disk->path($background->path),
                '@http' => ['stream' => true],
            ];
            $etag = '"'.$background->token.'"';
            $ifRange = $request->header('If-Range');
            $range = $request->header('Range', '');
            if (preg_match('/^bytes=(?:\d+-\d*|-\d+)$/D', $range)
                && (! $ifRange || $ifRange === $etag || (strtotime($ifRange) !== false && strtotime($ifRange) >= $background->updated_at->timestamp))) {
                $arguments['Range'] = $range;
            }
            $object = $disk->getClient()->getObject($arguments);
        } catch (S3Exception $error) {
            if ($error->getStatusCode() === 404) {
                abort(404);
            }
            if ($error->getStatusCode() === 416) {
                return response('', 416, ['Content-Range' => 'bytes */'.$background->size, 'Accept-Ranges' => 'bytes']);
            }
            report($error);
            abort(503, 'The login background is temporarily unavailable.');
        } catch (HttpException $error) {
            throw $error;
        } catch (Throwable $error) {
            report($error);
            abort(503, 'The login background is temporarily unavailable.');
        }

        $headers['Content-Length'] = (string) $object['ContentLength'];
        $headers['Accept-Ranges'] = 'bytes';
        $headers['ETag'] = $etag;
        $headers['Last-Modified'] = $background->updated_at->toRfc7231String();
        if (isset($object['ContentRange'])) {
            $headers['Content-Range'] = $object['ContentRange'];
        }
        $body = $object['Body'];

        return response()->stream(function () use ($body): void {
            try {
                while (! $body->eof()) {
                    echo $body->read(64 * 1024);
                }
            } finally {
                $body->close();
            }
        }, isset($object['ContentRange']) ? 206 : 200, $headers);
    }
}
