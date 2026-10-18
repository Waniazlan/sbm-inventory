<?php

namespace App\Http\Requests;

use Closure;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Http\UploadedFile;

class LoginBackgroundRequest extends FormRequest
{
    public const MIME_EXTENSIONS = [
        'image/jpeg' => 'jpg',
        'image/png' => 'png',
        'image/webp' => 'webp',
        'image/gif' => 'gif',
        'image/avif' => 'avif',
        'video/mp4' => 'mp4',
        'video/webm' => 'webm',
    ];

    public function authorize(): bool
    {
        return $this->user()?->role === 'admin' && $this->user()?->active;
    }

    public function rules(): array
    {
        return [
            'file' => [
                'bail',
                'required',
                'file',
                'mimetypes:'.implode(',', array_keys(self::MIME_EXTENSIONS)),
                function (string $attribute, mixed $value, Closure $fail): void {
                    if (! $value instanceof UploadedFile) {
                        return;
                    }

                    if ($value->getSize() === 0) {
                        $fail('The background file is empty. Choose an image or video with content.');

                        return;
                    }

                    $image = str_starts_with($value->getMimeType(), 'image/');
                    $limit = ($image ? 10 : 50) * 1024 * 1024;
                    if ($value->getSize() > $limit) {
                        $fail($image ? 'Images must be 10 MB or smaller.' : 'Videos must be 50 MB or smaller.');
                    }
                },
            ],
        ];
    }

    public function messages(): array
    {
        return [
            'file.required' => 'Choose an image or video for the login background.',
            'file.file' => 'The background could not be uploaded. Choose a valid file.',
            'file.mimetypes' => 'Choose a JPG, PNG, WebP, GIF or AVIF image, or an MP4 or WebM video.',
        ];
    }
}
