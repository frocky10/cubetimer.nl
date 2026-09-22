<?php
declare(strict_types=1);

require_once __DIR__ . '/Config.php';

/**
 * Rate limiting op bestanden, zodat het ook werkt zonder database.
 *
 * Per sleutel (bijv. "feedback:<gehasht ip>") wordt een JSON-bestandje
 * bijgehouden met de timestamps binnen het venster.
 */
final class RateLimiter
{
    /**
     * @return array{allowed:bool, remaining:int, retryAfter:int}
     */
    public static function hit(string $key, int $limit, int $windowSeconds): array
    {
        $directory = self::storageDirectory();
        if ($directory === null) {
            // Zonder schrijfbare map kunnen we niet limiteren; dan maar doorlaten.
            return ['allowed' => true, 'remaining' => $limit, 'retryAfter' => 0];
        }

        $file = $directory . '/' . hash('sha256', $key) . '.json';
        $now = time();

        $handle = @fopen($file, 'c+');
        if ($handle === false) {
            return ['allowed' => true, 'remaining' => $limit, 'retryAfter' => 0];
        }

        try {
            if (!flock($handle, LOCK_EX)) {
                return ['allowed' => true, 'remaining' => $limit, 'retryAfter' => 0];
            }

            $contents = stream_get_contents($handle);
            $timestamps = is_string($contents) && $contents !== ''
                ? (json_decode($contents, true) ?: [])
                : [];
            if (!is_array($timestamps)) {
                $timestamps = [];
            }

            $timestamps = array_values(array_filter(
                array_map('intval', $timestamps),
                static fn (int $stamp): bool => $stamp > $now - $windowSeconds
            ));

            if (count($timestamps) >= $limit) {
                $oldest = min($timestamps);
                return [
                    'allowed'    => false,
                    'remaining'  => 0,
                    'retryAfter' => max(1, ($oldest + $windowSeconds) - $now),
                ];
            }

            $timestamps[] = $now;

            ftruncate($handle, 0);
            rewind($handle);
            fwrite($handle, json_encode($timestamps));
            fflush($handle);

            return [
                'allowed'    => true,
                'remaining'  => max(0, $limit - count($timestamps)),
                'retryAfter' => 0,
            ];
        } finally {
            flock($handle, LOCK_UN);
            fclose($handle);
            self::pruneOldFiles($directory, $windowSeconds);
        }
    }

    private static function storageDirectory(): ?string
    {
        $base = (string) Config::get('storage_path', '');
        if ($base === '') {
            $base = sys_get_temp_dir() . '/cubetimer';
        }
        $directory = rtrim($base, '/') . '/ratelimit';

        if (!is_dir($directory) && !@mkdir($directory, 0770, true) && !is_dir($directory)) {
            return null;
        }
        return is_writable($directory) ? $directory : null;
    }

    /** Ruimt af en toe achtergelaten bestandjes op. */
    private static function pruneOldFiles(string $directory, int $windowSeconds): void
    {
        if (random_int(1, 100) !== 1) {
            return;
        }
        $cutoff = time() - max($windowSeconds * 4, 3600);
        foreach (glob($directory . '/*.json') ?: [] as $file) {
            if (@filemtime($file) < $cutoff) {
                @unlink($file);
            }
        }
    }
}
