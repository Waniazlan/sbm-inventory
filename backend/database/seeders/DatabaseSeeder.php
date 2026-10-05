<?php

namespace Database\Seeders;

use App\Models\Category;
use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    public function run(): void
    {
        foreach (['LCD / Display', 'Battery', 'Charging port', 'Camera', 'Speaker', 'Flex cable', 'Accessory'] as $name) {
            Category::firstOrCreate(['name' => $name]);
        }
    }
}
