<?php

namespace App\Http\Controllers;

use App\Models\LabelSetting;
use App\Services\Audit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class LabelSettingsController
{
    public function show(): array
    {
        return LabelSetting::findOrFail(1)->only(LabelSetting::FIELDS);
    }

    public function update(Request $request): array
    {
        $rules = array_fill_keys(LabelSetting::FIELDS, ['required', 'string', 'max:20', 'regex:/\A[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)*\z/']);
        $data = $request->validate($rules, [
            'regex' => 'Use letters and numbers, with hyphens or underscores between them. The separator before the sequence is added automatically.',
        ]);
        $settings = DB::transaction(function () use ($data) {
            $settings = LabelSetting::whereKey(1)->lockForUpdate()->firstOrFail();
            $before = $settings->only(LabelSetting::FIELDS);
            $settings->fill($data);
            if ($settings->isDirty()) {
                $settings->save();
                Audit::record('settings.label_prefixes_updated', 'label_settings:1', ['before' => $before, 'after' => $settings->only(LabelSetting::FIELDS)]);
            }

            return $settings->only(LabelSetting::FIELDS);
        });
        app()->forgetInstance(LabelSetting::class);

        return $settings;
    }
}
