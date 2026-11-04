<?php

use App\Models\User;
use Illuminate\Support\Facades\Broadcast;

Broadcast::channel('App.Models.User.{id}', function (User $user, int|string $id): bool {
    return (int) $user->id === (int) $id;
});

/*
| Канал проверки связи (этап 0). Доступен пользователям с профилем пилота.
| Игровые каналы presence-crew.{crewId} и private-session.{sessionId}.* — этап 3 (раздел 9.2).
*/
Broadcast::channel('diagnostics', function (User $user): array|false {
    $profile = $user->pilotProfile;

    if ($profile === null) {
        return false;
    }

    return ['id' => $user->id, 'callsign' => $profile->callsign];
});
