<?php
declare(strict_types=1);

namespace RouteRush;

final class Response
{
    public function __construct(
        public readonly int $status = 200,
        public readonly string $body = '',
        public readonly array $headers = [],
    ) {}

    public static function html(string $body, int $status = 200): self
    {
        return new self($status, $body, ['Content-Type' => 'text/html; charset=utf-8']);
    }

    public static function json(mixed $data, int $status = 200): self
    {
        return new self(
            $status,
            json_encode($data, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES),
            ['Content-Type' => 'application/json'],
        );
    }

    public static function notFound(): self
    {
        return self::json(['error' => 'not_found'], 404);
    }

    public function withHeader(string $name, string $value): self
    {
        return new self($this->status, $this->body, [$name => $value] + $this->headers);
    }

    public function send(): void
    {
        http_response_code($this->status);
        foreach ($this->headers as $name => $value) {
            header("$name: $value");
        }
        echo $this->body;
    }
}
