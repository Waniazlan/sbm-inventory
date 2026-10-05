<?php
// Write secrets directly to a protected file; never print their values.
require __DIR__.'/../backend/vendor/autoload.php';
if (!in_array($argc, [4, 5], true) || !in_array($argv[3], ['local', 'digitalocean'], true)) {
    fwrite(STDERR, "Usage: php scripts/production-env.php SOURCE TARGET local|digitalocean\n");
    exit(1);
}
$source = file_get_contents($argv[1]);
$values = Dotenv\Dotenv::parse($source);
// Preserve the live application's encryption key when switching env files.
if ($argc === 5 && is_file($argv[4])) {
    $live = Dotenv\Dotenv::parse(file_get_contents($argv[4]));
    if (!empty($live['APP_KEY'])) {
        $values['APP_KEY'] = $live['APP_KEY'];
    }
}
$updates = [
    'APP_ENV' => 'production', 'APP_DEBUG' => 'false',
    'APP_URL' => 'https://inventory.vgadget.my', 'LOG_LEVEL' => 'warning',
    'FRONTEND_URL' => 'https://inventory.vgadget.my', 'SESSION_SECURE_COOKIE' => 'true',
    'SESSION_DOMAIN' => 'null', 'SESSION_SAME_SITE' => 'lax',
    'SANCTUM_STATEFUL_DOMAINS' => 'inventory.vgadget.my',
    'SESSION_DRIVER' => 'database', 'QUEUE_CONNECTION' => 'sync',
    'CACHE_STORE' => 'database',
];
$updates['APP_KEY'] = $values['APP_KEY'] ?? '';
if (empty($values['APP_KEY'])) {
    $updates['APP_KEY'] = 'base64:'.base64_encode(random_bytes(32));
}
if ($argv[3] === 'digitalocean') {
    $updates['DB_CONNECTION'] = 'pgsql';
    $updates['DB_SEARCH_PATH'] = 'sbm-inventory';
    foreach (['HOST', 'PORT', 'DATABASE', 'USERNAME', 'PASSWORD', 'SSLMODE'] as $key) {
        if (empty($values['DO_DB_'.$key])) {
            fwrite(STDERR, "Missing DO_DB_$key\n");
            exit(1);
        }
        $updates['DB_'.$key] = "'".str_replace(["\\", "'"], ["\\\\", "\\'"], $values['DO_DB_'.$key])."'";
    }
    // DB_URL would otherwise take precedence over the selected credentials.
    $updates['DB_URL'] = 'null';
}
foreach ($updates as $key => $value) {
    $line = $key.'='.$value;
    $pattern = '/^'.preg_quote($key, '/').'\s*=.*$/m';
    if (preg_match($pattern, $source)) {
        $source = preg_replace_callback($pattern, fn () => $line, $source);
    } else {
        $source = rtrim($source)."\n".$line."\n";
    }
}
umask(0077);
if (file_put_contents($argv[2], $source) === false) {
    fwrite(STDERR, "Failed to write protected production environment.\n");
    exit(1);
}
chmod($argv[2], 0600);
echo "Production environment written; existing APP_KEY retained or a missing key generated.\n";
