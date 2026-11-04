<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Models\User;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Локаль: из профиля пользователя, иначе из Accept-Language, иначе ru (раздел 12).
 */
final class SetLocale
{
    public const SUPPORTED = ['ru', 'en'];

    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        $locale = $user instanceof User
            ? $user->locale
            : $request->getPreferredLanguage(self::SUPPORTED);

        app()->setLocale(in_array($locale, self::SUPPORTED, true) ? $locale : 'ru');

        return $next($request);
    }
}
