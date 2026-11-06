<?php

declare(strict_types=1);

namespace App\Domain\FlightSessions\Jobs;

use App\Domain\FlightSessions\Models\FlightSession;
use App\Domain\FlightSessions\Models\FlightSessionEvent;
use App\Domain\FlightSessions\Models\FlightSessionReplay;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Storage;

/**
 * Раздел 11 (BuildReplay): после разбора — файл повтора в S3. Мир детерминирован по сиду (раздел 1), поэтому
 * повтор — это миссия + версия + сид + журнал + трек; журнал в БД живёт 90 дней, повтор — 30 (или дольше, если закреплён).
 */
final class BuildReplay implements ShouldQueue
{
    use Queueable;

    public int $tries = 3;

    public function __construct(public int $sessionId) {}

    public function handle(): void
    {
        $session = FlightSession::query()->with('mission')->findOrFail($this->sessionId);
        $path = "replays/{$session->ulid}.json.gz";
        $payload = [
            'format_version' => FlightSessionReplay::FORMAT_VERSION,
            'session' => $session->ulid,
            'mission' => ['slug' => $session->mission->slug, 'version' => $session->mission_version],
            'seed' => $session->seed,
            'difficulty' => $session->difficulty,
            'outcome' => $session->outcome,
            'score' => $session->score,
            'track' => $session->debrief['track'] ?? [],
            'events' => $session->events()->orderBy('seq')->get(['seq', 'tick', 'type', 'payload'])
                ->map(fn (FlightSessionEvent $e): array => ['seq' => $e->seq, 'tick' => $e->tick, 'type' => $e->type, 'payload' => $e->payload])
                ->all(),
        ];
        $bytes = gzencode(json_encode($payload, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE), 9);

        if ($bytes === false) {
            throw new \RuntimeException('gzip failed');
        }

        Storage::put($path, $bytes);

        FlightSessionReplay::query()->updateOrCreate(['flight_session_id' => $session->id], [
            'storage_path' => $path,
            'bytes' => strlen($bytes),
            'format_version' => FlightSessionReplay::FORMAT_VERSION,
        ]);
    }
}
