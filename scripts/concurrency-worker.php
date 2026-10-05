<?php
require __DIR__.'/../backend/vendor/autoload.php';
$app=require __DIR__.'/../backend/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if(!app()->environment('testing')||config('database.connections.pgsql.database')!=='sbm_inventory_test')exit(9);
$data=json_decode($argv[1],true,512,JSON_THROW_ON_ERROR);
try{echo json_encode(app(App\Services\Ledger::class)->post($data,'sales'));exit(0);}catch(Illuminate\Validation\ValidationException $e){echo 'insufficient';exit(2);}
