<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;

class AuthController
{
    public function login(Request $r)
    {
        $data = $r->validate(['email' => 'required|email', 'password' => 'required|string']);
        if (! Auth::attempt([...$data, 'active' => true])) {
            throw ValidationException::withMessages(['email' => 'The credentials are incorrect or the account is disabled.']);
        }$r->session()->regenerate();

        return $r->user();
    }

    public function me(Request $r)
    {
        return $r->user();
    }

    public function updateProfile(Request $r)
    {
        $data = $r->validate(['name' => 'required|string|max:150']);
        $r->user()->update($data);

        return $r->user();
    }

    public function updatePassword(Request $r)
    {
        $data = $r->validate([
            'current_password' => 'required|string',
            'password' => 'required|string|min:12|max:200|confirmed',
        ]);
        if (! Hash::check($data['current_password'], $r->user()->password)) {
            throw ValidationException::withMessages(['current_password' => 'The current password is incorrect.']);
        }
        $r->user()->update(['password' => $data['password']]);

        return response()->noContent();
    }

    public function logout(Request $r)
    {
        Auth::guard('web')->logout();
        $r->session()->invalidate();
        $r->session()->regenerateToken();

        return response()->noContent();
    }
}
