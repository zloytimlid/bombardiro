<?php

declare(strict_types=1);

namespace App\Support;

use Sentry\Event;
use Sentry\EventHint;
use Sentry\UserDataBag;

/**
 * Sentry без персональных данных (раздел 13): остаётся только внутренний id игрока;
 * почта, имя, IP, cookie, заголовки авторизации и тела запросов вырезаются до отправки.
 */
final class SentryScrubber
{
    public static function beforeSend(Event $event, ?EventHint $hint = null): Event
    {
        $user = $event->getUser();

        if ($user !== null) {
            $event->setUser(new UserDataBag($user->getId()));
        }

        $request = $event->getRequest();

        if ($request !== []) {
            unset($request['cookies'], $request['data'], $request['env']);

            if (isset($request['headers']) && is_array($request['headers'])) {
                $request['headers'] = array_diff_key(array_change_key_case($request['headers']), array_flip(['cookie', 'authorization', 'x-xsrf-token', 'x-csrf-token', 'x-forwarded-for', 'x-real-ip']));
            }

            $event->setRequest($request);
        }

        return $event;
    }
}
