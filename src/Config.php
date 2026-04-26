<?php
declare(strict_types=1);

namespace RouteRush;

final class Config
{
    private function __construct(private readonly array $values) {}

    public static function load(string $path): self
    {
        if (!is_file($path)) {
            throw new \RuntimeException("Config file not found: $path. Copy config/config.example.php to config/config.php and fill in values.");
        }
        $values = require $path;
        if (!is_array($values)) {
            throw new \RuntimeException("Config file must return an array: $path");
        }
        return new self($values);
    }

    public function get(string $key, mixed $default = null): mixed
    {
        return $this->values[$key] ?? $default;
    }
}
