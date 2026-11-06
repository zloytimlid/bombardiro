<?php

declare(strict_types=1);

namespace App\Domain\Progression\Support;

use InvalidArgumentException;

/**
 * Декларативные условия достижений (раздел 10: criteria JSONB).
 *
 * Узел — `{"all": [...]}`, `{"any": [...]}` или `{"metric": "...", "op": "eq|ne|gte|lte|in", "value": ...}`.
 * Метрики берутся из контекста участника вылета (см. AwardAchievements::context):
 * outcome, verified, mission, difficulty, seat, score, humans, wounded, target.status, target.percent,
 * tot.within, profile.missions_total, station.<ключ метрики станции>.
 */
final class AchievementRules
{
    private const array OPS = ['eq', 'ne', 'gte', 'lte', 'in'];

    /**
     * @param  array<string, mixed>  $criteria
     * @param  array<string, mixed>  $context
     */
    public static function matches(array $criteria, array $context): bool
    {
        if (isset($criteria['all'])) {
            foreach (self::nodes($criteria['all']) as $node) {
                if (! self::matches($node, $context)) {
                    return false;
                }
            }

            return true;
        }

        if (isset($criteria['any'])) {
            foreach (self::nodes($criteria['any']) as $node) {
                if (self::matches($node, $context)) {
                    return true;
                }
            }

            return false;
        }

        $metric = $criteria['metric'] ?? null;
        $op = $criteria['op'] ?? null;

        if (! is_string($metric) || ! in_array($op, self::OPS, true)) {
            throw new InvalidArgumentException('Invalid achievement criteria node');
        }

        if (! array_key_exists($metric, $context) || $context[$metric] === null) {
            return false;
        }

        $actual = $context[$metric];
        $expected = $criteria['value'] ?? null;

        return match ($op) {
            'eq' => $actual === $expected,
            'ne' => $actual !== $expected,
            'gte' => is_numeric($actual) && is_numeric($expected) && $actual >= $expected,
            'lte' => is_numeric($actual) && is_numeric($expected) && $actual <= $expected,
            'in' => is_array($expected) && in_array($actual, $expected, true),
        };
    }

    /**
     * Проверка каталога при загрузке: каждая ветка — корректный узел.
     *
     * @param  array<string, mixed>  $criteria
     */
    public static function validate(array $criteria): void
    {
        if (isset($criteria['all']) || isset($criteria['any'])) {
            foreach (self::nodes($criteria['all'] ?? $criteria['any']) as $node) {
                self::validate($node);
            }

            return;
        }

        if (! is_string($criteria['metric'] ?? null) || ! in_array($criteria['op'] ?? null, self::OPS, true) || ! array_key_exists('value', $criteria)) {
            throw new InvalidArgumentException('Invalid achievement criteria node: '.json_encode($criteria));
        }
    }

    /**
     * @return list<array<string, mixed>>
     */
    private static function nodes(mixed $value): array
    {
        if (! is_array($value)) {
            throw new InvalidArgumentException('Achievement criteria branch must be a list');
        }

        /** @var list<array<string, mixed>> */
        return array_values(array_filter($value, 'is_array'));
    }
}
