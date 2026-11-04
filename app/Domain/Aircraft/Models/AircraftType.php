<?php

declare(strict_types=1);

namespace App\Domain\Aircraft\Models;

use Database\Factories\AircraftTypeFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\UseFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

/**
 * @property int $id
 * @property string $slug
 * @property string $name
 * @property array<string, mixed> $config
 * @property int $config_version
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['slug', 'name', 'config', 'config_version'])]
#[UseFactory(AircraftTypeFactory::class)]
class AircraftType extends Model
{
    /** @use HasFactory<AircraftTypeFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'config' => 'array',
            'config_version' => 'integer',
        ];
    }

    /**
     * @return HasMany<Airframe, $this>
     */
    public function airframes(): HasMany
    {
        return $this->hasMany(Airframe::class);
    }
}
