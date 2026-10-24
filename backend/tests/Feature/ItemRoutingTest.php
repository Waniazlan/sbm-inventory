<?php

namespace Tests\Feature;

use App\Http\Controllers\CatalogueController;
use Illuminate\Http\Request;
use Tests\TestCase;

class ItemRoutingTest extends TestCase
{
    public function test_item_options_uses_the_dropdown_endpoint(): void
    {
        $route = app('router')->getRoutes()->match(Request::create('/api/v1/items/options'));

        $this->assertSame(CatalogueController::class.'@options', $route->getActionName());
        $this->assertSame([], $route->parameters());
    }

    public function test_numeric_item_ids_still_match_show_and_save(): void
    {
        foreach (['GET' => 'show', 'PUT' => 'save'] as $method => $action) {
            $route = app('router')->getRoutes()->match(Request::create('/api/v1/items/123', $method));

            $this->assertSame(CatalogueController::class.'@'.$action, $route->getActionName());
            $this->assertSame('123', $route->parameter('item'));
        }
    }

    public function test_invalid_item_ids_return_not_found_before_database_binding(): void
    {
        foreach (['unknown', '123abc', '-1', '1.5'] as $id) {
            $this->getJson('/api/v1/items/'.$id)->assertNotFound();
            $this->putJson('/api/v1/items/'.$id)->assertNotFound();
        }
        $this->putJson('/api/v1/items/options')->assertStatus(405);
    }
}
