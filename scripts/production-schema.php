<?php
require __DIR__.'/../backend/vendor/autoload.php';
if ($argc !== 2 || !is_file($argv[1])) {
    fwrite(STDERR, "Usage: php scripts/production-schema.php ENV_FILE\n");
    exit(1);
}
$v = Dotenv\Dotenv::parse(file_get_contents($argv[1]));
$stage = 'connect to the maintenance database';
try {
    $connect = fn ($database) => new PDO(
        'pgsql:host='.$v['DB_HOST'].';port='.$v['DB_PORT'].';dbname='."'".str_replace(["\\", "'"], ["\\\\", "\\'"], $database)."'".';sslmode='.$v['DB_SSLMODE'].';connect_timeout=10',
        $v['DB_USERNAME'], $v['DB_PASSWORD'], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
    );
    $db = $connect($v['DO_DB_MAINTENANCE_DATABASE'] ?? 'defaultdb');
    $exists = $db->prepare('SELECT 1 FROM pg_database WHERE datname = ?');
    $exists->execute([$v['DB_DATABASE']]);
    if (!$exists->fetchColumn()) {
        $stage = 'create the production database';
        $name = '"'.str_replace('"', '""', $v['DB_DATABASE']).'"';
        $db->exec('CREATE DATABASE '.$name);
        echo "Production database created.\n";
    }
    $stage = 'connect to the production database';
    $db = $connect($v['DB_DATABASE']);
    $stage = 'create the Inventory schema';
    $db->exec('CREATE SCHEMA IF NOT EXISTS "sbm-inventory"');
    echo "Inventory database schema ready.\n";
} catch (Throwable $e) {
    $message = $e->getMessage();
    foreach (['DB_PASSWORD', 'DO_DB_PASSWORD', 'DB_USERNAME', 'DO_DB_USERNAME'] as $key) {
        if (!empty($v[$key])) {
            $message = str_replace($v[$key], '[redacted]', $message);
        }
    }
    fwrite(STDERR, "Failed to $stage: $message\n");
    exit(1);
}
