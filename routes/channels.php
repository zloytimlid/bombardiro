<?php

use App\Domain\FlightSessions\Support\ChannelAuth;
use App\Models\User;
use Illuminate\Support\Facades\Broadcast;

Broadcast::channel('App.Models.User.{id}', function (User $user, int|string $id): bool {
    return (int) $user->id === (int) $id;
});

/*
| Канал проверки связи (этап 0). Доступен пользователям с профилем пилота.
*/
Broadcast::channel('diagnostics', function (User $user): array|false {
    $profile = $user->pilotProfile;

    if ($profile === null) {
        return false;
    }

    return ['id' => $user->id, 'callsign' => $profile->callsign];
});

/*
| Игровые каналы (раздел 9.2). Авторизация — только участники (App\Domain\FlightSessions\Support\ChannelAuth).
*/
// Замыкания, а не [класс, метод]: Broadcaster читает параметры колбэка через ReflectionFunction.
Broadcast::channel('crew.{crew}', fn (User $user, string $crew): array|false => ChannelAuth::crew($user, $crew));
Broadcast::channel('session.{session}', fn (User $user, string $session): bool => ChannelAuth::session($user, $session));
Broadcast::channel('session.{session}.input.{seat}', fn (User $user, string $session, string $seat): bool => ChannelAuth::input($user, $session, $seat));
// Звено (этап 6): положение самолётов звена.
Broadcast::channel('flight.{flight}', fn (User $user, string $flight): array|false => ChannelAuth::flight($user, $flight));
