<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Models\User;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Symfony\Component\HttpFoundation\Response;

/**
 * Модерация: заблокированный игрок выходит из аккаунта при следующем запросе.
 */
final class EnsureNotBanned
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if ($user instanceof User && $user->banned_at !== null) {
            Auth::guard('web')->logout();
            $request->session()->invalidate();
            $request->session()->regenerateToken();

            $message = __('account.banned');

            return $request->expectsJson() ? response()->json(['message' => $message], 403) : redirect()->route('login')->with('status', $message);
        }

        return $next($request);
    }
}
