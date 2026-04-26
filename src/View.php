<?php
declare(strict_types=1);

namespace RouteRush;

final class View
{
    public static function render(string $name, array $data = []): string
    {
        $path = __DIR__ . '/../views/' . $name . '.php';
        if (!is_file($path)) {
            throw new \RuntimeException("View not found: $name");
        }

        extract($data, EXTR_SKIP);
        ob_start();
        require $path;
        return (string) ob_get_clean();
    }

    public static function escape(string $s): string
    {
        return htmlspecialchars($s, ENT_QUOTES | ENT_HTML5, 'UTF-8');
    }
}
