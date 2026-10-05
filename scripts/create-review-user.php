<?php
// Local browser verification only. Never run against a production database.
require __DIR__.'/../backend/vendor/autoload.php';
$app=require __DIR__.'/../backend/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if(!app()->environment('local') || config('database.connections.pgsql.database')!=='sbm_inventory') {fwrite(STDERR,"Requires the local sbm_inventory database.\n");exit(1);}
$file=__DIR__.'/../backend/.review-credentials.json';
if(file_exists($file)){echo "Review credentials already exist.\n";exit;}
$password=bin2hex(random_bytes(18));
App\Models\User::create(['name'=>'Inventory Administrator','email'=>'inventory-admin@local.test','password'=>$password,'role'=>'admin','active'=>true]);
file_put_contents($file,json_encode(['email'=>'inventory-admin@local.test','password'=>$password],JSON_PRETTY_PRINT)."\n");chmod($file,0600);
echo "Local administrator created. Credentials are in backend/.review-credentials.json.\n";
