<?php

namespace App\Http\Middleware;

use App\Domain\Accounts\Actions\AccountService;
use App\Domain\Accounts\Actions\SocialLogin;
use App\Models\User;
use Illuminate\Http\Request;
use Inertia\Middleware;

class HandleInertiaRequests extends Middleware
{
    /**
     * The root template that's loaded on the first page visit.
     *
     * @see https://inertiajs.com/server-side-setup#root-template
     *
     * @var string
     */
    protected $rootView = 'app';

    /**
     * Determines the current asset version.
     *
     * @see https://inertiajs.com/asset-versioning
     */
    public function version(Request $request): ?string
    {
        return parent::version($request);
    }

    /**
     * Define the props that are shared by default.
     *
     * @see https://inertiajs.com/shared-data
     *
     * @return array<string, mixed>
     */
    public function share(Request $request): array
    {
        return [
            ...parent::share($request),
            'name' => config('app.name'),
            'locale' => app()->getLocale(),
            'auth' => [
                'user' => $request->user(),
            ],
            'sidebarOpen' => ! $request->hasCookie('sidebar_state') || $request->cookie('sidebar_state') === 'true',
            // Настройки игрока (управление, графика, звук, доступность) — одна схема UserSettingsData.
            'settings' => fn () => ($user = $request->user()) instanceof User ? app(AccountService::class)->settings($user) : null,
            // Кнопки входа через Discord/Google — только для настроенных провайдеров.
            'socialProviders' => fn () => SocialLogin::available(),
            // Голосовое СПУ: STUN/TURN-серверы (config/services.php).
            'voice' => fn () => ['ice' => config('services.voice.ice', [])],
        ];
    }
}
