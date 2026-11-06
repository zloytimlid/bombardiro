<?php

declare(strict_types=1);

namespace App\Http\Controllers\Auth;

use App\Domain\Accounts\Actions\SocialLogin;
use App\Http\Controllers\Controller;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Laravel\Socialite\Facades\Socialite;
use Laravel\Socialite\Two\AbstractProvider;
use Symfony\Component\HttpFoundation\RedirectResponse as SymfonyRedirect;
use Throwable;

/**
 * Вход через Discord и Google (этап 5): OAuth — Socialite; ключи — в .env (без ключей кнопок нет).
 */
final class SocialAuthController extends Controller
{
    public function redirect(string $provider): SymfonyRedirect
    {
        abort_unless(SocialLogin::enabled($provider), 404);

        /** @var AbstractProvider $driver */
        $driver = Socialite::driver($provider);

        return $provider === 'discord' ? $driver->scopes(['identify', 'email'])->redirect() : $driver->redirect();
    }

    public function callback(Request $request, string $provider, SocialLogin $login): RedirectResponse
    {
        abort_unless(SocialLogin::enabled($provider), 404);

        try {
            $external = Socialite::driver($provider)->user();
        } catch (Throwable) {
            return redirect()->route('login')->with('status', __('auth.social_failed'));
        }

        $user = $login->resolve($provider, $external);

        if ($user->banned_at !== null) {
            return redirect()->route('login')->with('status', __('account.banned'));
        }

        Auth::login($user, remember: true);
        $request->session()->regenerate();

        return redirect()->intended(route('dashboard'));
    }
}
