<?php

namespace App\Models;

use Illuminate\Foundation\Auth\User as Authenticatable;

class User extends Authenticatable
{
    protected $attributes = ['active' => true, 'role' => 'technician'];

    protected $guarded = ['id'];

    protected $hidden = ['password', 'remember_token', 'avatar_path', 'avatar_disk'];

    protected $appends = ['avatar_url'];

    public function getAvatarUrlAttribute(): ?string
    {
        return $this->avatar_path
            ? route('profile.picture', ['token' => pathinfo($this->avatar_path, PATHINFO_FILENAME)], false)
            : null;
    }

    protected function casts(): array
    {
        return ['password' => 'hashed', 'active' => 'boolean'];
    }
}
