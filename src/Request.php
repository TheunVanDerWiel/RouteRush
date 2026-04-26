<?php
declare(strict_types=1);

namespace RouteRush;

final class Request
{
    public function __construct(
        public readonly string $method,
        public readonly string $path,
        public readonly array $query,
        public readonly array $body,
        public readonly array $headers,
    ) {}

    public static function fromGlobals(): self
    {
        $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
        $uri    = $_SERVER['REQUEST_URI'] ?? '/';
        $path   = parse_url($uri, PHP_URL_PATH) ?: '/';

        $body = [];
        if (in_array($method, ['POST', 'PUT', 'PATCH'], true)) {
            $contentType = $_SERVER['CONTENT_TYPE'] ?? '';
            if (str_contains($contentType, 'application/json')) {
                $raw  = file_get_contents('php://input') ?: '';
                $body = json_decode($raw, true) ?: [];
            } else {
                $body = $_POST;
            }
        }

        $headers = function_exists('getallheaders') ? (getallheaders() ?: []) : [];

        return new self($method, $path, $_GET, $body, $headers);
    }
}
