<?php

declare(strict_types=1);

namespace App\Domain\Missions\Models;

use App\Domain\Missions\Enums\MissionDifficulty;
use Database\Factories\MissionFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\UseFactory;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * Версия миссии (раздел 10): вылет ссылается на конкретную версию; правка опубликованной — новая версия.
 *
 * @property int $id
 * @property string $slug
 * @property int $version
 * @property array<string, string> $title
 * @property int $theatre_id
 * @property Carbon|null $historical_date
 * @property MissionDifficulty $difficulty
 * @property array<string, mixed> $definition
 * @property bool $is_published
 * @property bool $placeholder
 * @property list<array<string, string>> $sources
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 * @property-read Theatre $theatre
 */
#[Fillable(['slug', 'version', 'title', 'theatre_id', 'historical_date', 'difficulty', 'definition', 'is_published', 'placeholder', 'sources'])]
#[UseFactory(MissionFactory::class)]
class Mission extends Model
{
    /** @use HasFactory<MissionFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'title' => 'array',
            'definition' => 'array',
            'sources' => 'array',
            'historical_date' => 'date',
            'difficulty' => MissionDifficulty::class,
            'is_published' => 'boolean',
            'placeholder' => 'boolean',
            'version' => 'integer',
        ];
    }

    /**
     * @return BelongsTo<Theatre, $this>
     */
    public function theatre(): BelongsTo
    {
        return $this->belongsTo(Theatre::class);
    }

    /**
     * Последние опубликованные версии каждой миссии.
     *
     * @param  Builder<Mission>  $query
     * @return Builder<Mission>
     */
    public function scopeLatestPublished(Builder $query): Builder
    {
        return $query
            ->where('is_published', true)
            ->whereRaw('version = (select max(m2.version) from missions m2 where m2.slug = missions.slug and m2.is_published = true)');
    }

    public static function latestPublished(string $slug): ?self
    {
        return self::query()->where('slug', $slug)->where('is_published', true)->orderByDesc('version')->first();
    }

    public function localizedTitle(string $locale): string
    {
        return $this->title[$locale] ?? $this->title['en'] ?? $this->slug;
    }

    /**
     * Краткое описание для каталога — общий брифинг.
     *
     * @return array<string, string>
     */
    public function summary(): array
    {
        /** @var array{general?: array<string, string>} $briefing */
        $briefing = $this->definition['briefing'] ?? [];

        return $briefing['general'] ?? ['ru' => '', 'en' => ''];
    }
}
