<?php

declare(strict_types=1);

namespace App\Domain\Aircraft\Models;

use Database\Factories\AirframeFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\UseFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * @property int $id
 * @property int $aircraft_type_id
 * @property string $serial
 * @property string $name
 * @property string|null $livery
 * @property array<string, mixed> $state
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 * @property-read AircraftType $aircraftType
 */
#[Fillable(['aircraft_type_id', 'serial', 'name', 'livery', 'state'])]
#[UseFactory(AirframeFactory::class)]
class Airframe extends Model
{
    /** @use HasFactory<AirframeFactory> */
    use HasFactory;

    /** @var array<string, mixed> */
    protected $attributes = ['state' => '{}'];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return ['state' => 'array'];
    }

    /**
     * @return BelongsTo<AircraftType, $this>
     */
    public function aircraftType(): BelongsTo
    {
        return $this->belongsTo(AircraftType::class);
    }
}
