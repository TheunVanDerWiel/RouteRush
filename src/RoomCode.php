<?php
declare(strict_types=1);

namespace RouteRush;

final class RoomCode
{
    // Removed I, L, O, 0, 1 to avoid OCR/typo confusion when shared verbally.
    private const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    private const LENGTH = 6;

    public static function generate(): string
    {
        $alphabet = self::ALPHABET;
        $max = strlen($alphabet) - 1;
        $code = '';
        for ($i = 0; $i < self::LENGTH; $i++) {
            $code .= $alphabet[random_int(0, $max)];
        }
        return $code;
    }
}
