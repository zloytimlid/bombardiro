<?php

declare(strict_types=1);

namespace App\Domain\Campaigns\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;

/**
 * Кампания (этап 6): миссии по порядку и правила ремонта; контент — resources/sim/campaigns/*.json.
 *
 * @property int $id
 * @property string $slug
 * @property array<string, string> $title
 * @property array<string, string> $description
 * @property list<string> $missions
 * @property array{repair_per_day: array{value: float}, advance_on: list<string>, retry_on_failure: bool} $rules
 * @property bool $placeholder
 */
#[Fillable(['slug', 'title', 'description', 'missions', 'rules', 'placeholder'])]
class Campaign extends Model
{
    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return ['title' => 'array', 'description' => 'array', 'missions' => 'array', 'rules' => 'array', 'placeholder' => 'boolean'];
    }
}
