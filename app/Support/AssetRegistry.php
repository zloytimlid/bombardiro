<?php

declare(strict_types=1);

namespace App\Support;

use Illuminate\Support\Facades\File;

/**
 * Реестр ассетов (раздел 13, «Ассеты и права»): таблица docs/assets.md — единственный источник
 * для страницы «О проекте» и проверки в тестах.
 */
final class AssetRegistry
{
    /**
     * @return list<array{path: string, what: string, source: string, license: string, attribution: string}>
     */
    public static function entries(): array
    {
        $path = base_path('docs/assets.md');

        if (! File::exists($path)) {
            return [];
        }

        $rows = [];

        // Не preg_split('/\R/') без /u: байт 0x85 внутри UTF-8 (буква «х») PCRE принимает за перевод строки.
        foreach (explode("\n", str_replace("\r", '', File::get($path))) as $line) {
            if (! str_starts_with($line, '|') || preg_match('/^\|\s*-+/', $line) === 1) {
                continue;
            }

            $cells = array_map('trim', explode('|', trim($line, " \t|")));

            if (count($cells) < 5 || $cells[0] === 'Путь') {
                continue;
            }

            $rows[] = ['path' => $cells[0], 'what' => $cells[1], 'source' => $cells[2], 'license' => $cells[3], 'attribution' => $cells[4]];
        }

        return $rows;
    }
}
