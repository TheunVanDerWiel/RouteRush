<?php
declare(strict_types=1);

namespace RouteRush;

/**
 * Thin wrapper around PHP's mail() so the call site can be mocked or
 * swapped without touching controllers. Reads From: details from the
 * editor config block.
 */
final class Mailer
{
    public function __construct(private readonly array $config) {}

    public function send(string $to, string $subject, string $body): bool
    {
        $fromEmail = $this->config['from_email'] ?? null;
        $fromName  = $this->config['from_name']  ?? 'Route Rush';
        if (!is_string($fromEmail) || $fromEmail === '') {
            return false;
        }
        $headers = [
            'From: ' . $fromName . ' <' . $fromEmail . '>',
            'Content-Type: text/plain; charset=UTF-8',
            'X-Mailer: RouteRush',
        ];
        return mail($to, $subject, $body, implode("\r\n", $headers));
    }
}
