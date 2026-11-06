<?php

declare(strict_types=1);

namespace App\Domain\Progression\Models;

use Database\Factories\AchievementFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\UseFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * Достижение (раздел 10): условие — декларативное дерево `criteria`, проверяет AchievementRules.
 *
 * @property int $id
 * @property string $slug
 * @property array<string, string> $title
 * @property array<string, string> $description
 * @property array<string, mixed> $criteria
 * @property string $icon
 * @property int $sort
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['slug', 'title', 'description', 'criteria', 'icon', 'sort'])]
#[UseFactory(AchievementFactory::class)]
class Achievement extends Model
{
    /** @use HasFactory<AchievementFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'title' => 'array',
            'description' => 'array',
            'criteria' => 'array',
        ];
    }
}
