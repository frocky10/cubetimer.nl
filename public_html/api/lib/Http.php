<?php
declare(strict_types=1);

/**
 * Kleine helper rond request en response: JSON lezen, JSON schrijven,
 * en het afdwingen van de methode.
 */
final class Http
{
    /** @var array<string,mixed>|null */
    private static ?array $body = null;

    public static function method(): string
    {
        return strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
    }

    /** Stuurt 405 als de methode niet klopt. Handelt ook de preflight af. */
    public static function requireMethod(string ...$allowed): void
    {
        if (self::method() === 'OPTIONS') {
            header('Allow: ' . implode(', ', $allowed));
            http_response_code(204);
            exit;
        }
        if (!in_array(self::method(), $allowed, true)) {
            header('Allow: ' . implode(', ', $allowed));
            self::fail('method_not_allowed', 'Deze methode wordt hier niet ondersteund.', 405);
        }
    }

    /**
     * Beschermt tegen CSRF vanuit een ander domein: een simpel <form> kan deze
     * header niet zetten, en de sessiecookie is SameSite=Lax.
     */
    public static function requireAjaxHeader(): void
    {
        $header = $_SERVER['HTTP_X_REQUESTED_WITH'] ?? '';
        if (strcasecmp((string) $header, 'XMLHttpRequest') !== 0) {
            self::fail('bad_request', 'Ontbrekende X-Requested-With header.', 400);
        }
    }

    /** @return array<string,mixed> De JSON-body van het verzoek. */
    public static function json(): array
    {
        if (self::$body !== null) {
            return self::$body;
        }
        $raw = file_get_contents('php://input');
        if ($raw === false || $raw === '') {
            return self::$body = [];
        }
        $decoded = json_decode($raw, true);
        if (!is_array($decoded)) {
            self::fail('invalid_json', 'De aanvraag bevat geen geldige JSON.', 400);
        }
        return self::$body = $decoded;
    }

    public static function input(string $key, mixed $default = null): mixed
    {
        $body = self::json();
        return $body[$key] ?? $default;
    }

    public static function stringInput(string $key, string $default = ''): string
    {
        $value = self::input($key, $default);
        return is_scalar($value) ? trim((string) $value) : $default;
    }

    public static function clientIp(): string
    {
        return (string) ($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0');
    }

    public static function userAgent(): string
    {
        return substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 255);
    }

    /**
     * Stuurt een geslaagd antwoord en stopt.
     * @param array<string,mixed> $data
     */
    public static function ok(array $data = [], int $status = 200): never
    {
        self::send(['ok' => true] + $data, $status);
    }

    /**
     * Stuurt een foutantwoord en stopt.
     * @param array<string,mixed> $extra
     */
    public static function fail(string $code, string $message, int $status = 400, array $extra = []): never
    {
        self::send(['ok' => false, 'error' => $code, 'message' => $message] + $extra, $status);
    }

    /** @param array<string,mixed> $payload */
    private static function send(array $payload, int $status): never
    {
        // Meldingen in de taal van de pagina (zie Taal).
        if (isset($payload['message']) && is_string($payload['message']) && class_exists('Taal', false)) {
            $payload['message'] = Taal::t($payload['message']);
        }
        if (!headers_sent()) {
            http_response_code($status);
            header('Content-Type: application/json; charset=utf-8');
            header('Cache-Control: no-store');
            header('X-Content-Type-Options: nosniff');
            header('Vary: X-Taal');
        }
        echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        exit;
    }
}
