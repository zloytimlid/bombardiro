<?php

declare(strict_types=1);

namespace App\Domain\Missions\Models;

use Database\Factories\TheatreFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\UseFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * @property int $id
 * @property string $slug
 * @property array<string, string> $name
 * @property string $origin_lat
 * @property string $origin_lon
 * @property array<string, float|int> $bounds
 * @property string|null $terrain_manifest_url
 * @property array<string, mixed> $definition
 * @property bool $placeholder
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['slug', 'name', 'origin_lat', 'origin_lon', 'bounds', 'terrain_manifest_url', 'definition', 'placeholder'])]
#[UseFactory(TheatreFactory::class)]
class Theatre extends Model
{
    /** @use HasFactory<TheatreFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'name' => 'array',
            'bounds' => 'array',
            'definition' => 'array',
            'placeholder' => 'boolean',
        ];
    }

    public function localizedName(string $locale): string
    {
        return $this->name[$locale] ?? $this->name['en'] ?? $this->slug;
    }
}
