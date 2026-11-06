<?php

declare(strict_types=1);

namespace App\Domain\FlightSessions\Support;

use App\Domain\Aircraft\Enums\Station;
use App\Domain\Crews\Models\Crew;
use App\Domain\Flights\Models\Flight;
use App\Domain\FlightSessions\Models\FlightSession;
use App\Models\User;

/**
 * Авторизация игровых каналов (раздел 9.2): только участники; канал ввода места —
 * только владелец места и хост, чтобы whisper ввода получал один адресат.
 */
final class ChannelAuth
{
    /**
     * presence-crew.{crew}: лобби и присутствие во время вылета.
     *
     * @return array{id: int, callsign: string}|false
     */
    public static function crew(User $user, string $crew): array|false
    {
        $model = Crew::query()->where('ulid', $crew)->first();

        if ($model === null || ! $model->hasMember($user)) {
            return false;
        }

        return ['id' => $user->id, 'callsign' => $user->pilotProfile->callsign ?? $user->name];
    }

    /**
     * presence-flight.{flight} (этап 6): положение самолётов звена — участникам любого экипажа звена.
     *
     * @return array{id: int, callsign: string}|false
     */
    public static function flight(User $user, string $flight): array|false
    {
        $model = Flight::query()->where('ulid', $flight)->first();

        if ($model === null || ! Crew::query()->where('flight_id', $model->id)->whereHas('members', fn ($q) => $q->where('user_id', $user->id))->exists()) {
            return false;
        }

        return ['id' => $user->id, 'callsign' => $user->pilotProfile->callsign ?? $user->name];
    }

    /** private-session.{session}: снапшоты хоста, события, команды экипажа. */
    public static function session(User $user, string $session): bool
    {
        $model = FlightSession::query()->where('ulid', $session)->first();

        return $model !== null && $model->crew->hasMember($user);
    }

    /** private-session.{session}.input.{seat}: владелец места и хост. */
    public static function input(User $user, string $session, string $seat): bool
    {
        $model = FlightSession::query()->where('ulid', $session)->first();

        if ($model === null || Station::tryFrom($seat) === null) {
            return false;
        }

        if ($model->isHost($user)) {
            return true;
        }

        return $model->crew->memberFor($user)?->seat?->value === $seat;
    }
}
