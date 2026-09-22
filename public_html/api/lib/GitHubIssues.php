<?php
declare(strict_types=1);

require_once __DIR__ . '/Config.php';

/**
 * Maakt issues aan via de GitHub REST API.
 *
 * Het token staat alleen in het configbestand buiten de webroot en verlaat de
 * server nooit richting de browser.
 */
final class GitHubIssues
{
    public static function isEnabled(): bool
    {
        return (string) Config::get('github.token', '') !== ''
            && (string) Config::get('github.owner', '') !== ''
            && (string) Config::get('github.repo', '') !== '';
    }

    /**
     * @param list<string> $labels
     * @return array{ok:bool, number?:int, url?:string, error?:string, status?:int}
     */
    public static function create(string $title, string $body, array $labels = []): array
    {
        if (!self::isEnabled()) {
            return ['ok' => false, 'error' => 'GitHub is niet geconfigureerd op deze server.'];
        }
        if (!function_exists('curl_init')) {
            return ['ok' => false, 'error' => 'De cURL-extensie van PHP ontbreekt op deze server.'];
        }

        $owner = rawurlencode((string) Config::get('github.owner', ''));
        $repo  = rawurlencode((string) Config::get('github.repo', ''));
        $url   = "https://api.github.com/repos/{$owner}/{$repo}/issues";

        $payload = ['title' => $title, 'body' => $body];
        if ($labels !== []) {
            $payload['labels'] = array_values(array_unique($labels));
        }

        $curl = curl_init($url);
        curl_setopt_array($curl, [
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 15,
            CURLOPT_CONNECTTIMEOUT => 8,
            CURLOPT_HTTPHEADER     => [
                'Accept: application/vnd.github+json',
                'X-GitHub-Api-Version: 2022-11-28',
                'Content-Type: application/json',
                'Authorization: Bearer ' . (string) Config::get('github.token', ''),
                'User-Agent: CubeTimer-Feedback/1.0',
            ],
        ]);

        $response = curl_exec($curl);
        $status   = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
        $curlErr  = curl_error($curl);
        curl_close($curl);

        if ($response === false) {
            error_log('[cubetimer] GitHub-aanroep mislukt: ' . $curlErr);
            return ['ok' => false, 'error' => 'Kon GitHub niet bereiken.', 'status' => 0];
        }

        $decoded = json_decode((string) $response, true);

        if ($status >= 200 && $status < 300 && is_array($decoded) && isset($decoded['number'])) {
            return [
                'ok'     => true,
                'number' => (int) $decoded['number'],
                'url'    => (string) ($decoded['html_url'] ?? ''),
            ];
        }

        $message = is_array($decoded) && isset($decoded['message'])
            ? (string) $decoded['message']
            : 'Onbekende fout van GitHub.';
        error_log("[cubetimer] GitHub gaf {$status}: {$message}");

        return ['ok' => false, 'error' => $message, 'status' => $status];
    }
}
