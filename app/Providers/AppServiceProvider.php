<?php

namespace App\Providers;

use App\Livewire\Pulse\ClientTelemetry;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Date;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\URL;
use Illuminate\Support\ServiceProvider;
use Illuminate\Validation\Rules\Password;
use Livewire\Livewire;
use SocialiteProviders\Discord\DiscordExtendSocialite;
use SocialiteProviders\Manager\SocialiteWasCalled;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        $this->configureDefaults();

        // Сайт за HTTPS-прокси (APP_URL https://…): ссылки и редиректы — от APP_URL, а не от заголовка Host,
        // который прокси может подменить на адрес сервера за ним.
        $appUrl = (string) config('app.url');

        if (str_starts_with($appUrl, 'https://')) {
            URL::forceRootUrl($appUrl);
            URL::forceScheme('https');
        }

        // Discord для Socialite (socialiteproviders/discord); карточка телеметрии в Pulse.
        Event::listen(SocialiteWasCalled::class, [DiscordExtendSocialite::class, 'handle']);
        Livewire::component('pulse.client-telemetry', ClientTelemetry::class);
    }

    /**
     * Configure default behaviors for production-ready applications.
     */
    protected function configureDefaults(): void
    {
        Date::use(CarbonImmutable::class);

        // Раздел 11: всё, кроме events/snapshot, — 120 запросов в минуту на пользователя.
        RateLimiter::for('api', fn (Request $request): Limit => Limit::perMinute(120)
            ->by((string) ($request->user()?->getAuthIdentifier() ?? $request->ip())));

        // Раздел 11: events — 60/мин на сессию; snapshot — 40/мин на сессию (снапшот раз в 2 с, см. assumptions.md);
        // отметки присутствия хоста — раз в секунду.
        // Лимитер срабатывает до привязки модели — ключ по ULID из маршрута.
        $session = function (Request $request): string {
            $route = $request->route('session');

            return is_object($route) && method_exists($route, 'getRouteKey') ? (string) $route->getRouteKey() : (is_string($route) ? $route : (string) $request->ip());
        };

        RateLimiter::for('session-events', fn (Request $request): Limit => Limit::perMinute(60)->by('events:'.$session($request)));
        RateLimiter::for('session-snapshot', fn (Request $request): Limit => Limit::perMinute(40)->by('snapshot:'.$session($request)));
        RateLimiter::for('session-heartbeat', fn (Request $request): Limit => Limit::perMinute(180)
            ->by('heartbeat:'.($request->user()?->getAuthIdentifier() ?? $request->ip())));

        // Клиентская телеметрия FPS/RTT — раз в 30 с с запасом.
        RateLimiter::for('telemetry', fn (Request $request): Limit => Limit::perMinute(6)
            ->by('telemetry:'.($request->user()?->getAuthIdentifier() ?? $request->ip())));

        // Pulse (медленные запросы, очереди, Reverb, телеметрия) — только админ.
        Gate::define('viewPulse', fn (User $user): bool => $user->isAdmin());

        DB::prohibitDestructiveCommands(
            app()->isProduction(),
        );

        Password::defaults(fn (): ?Password => app()->isProduction()
            ? Password::min(12)
                ->mixedCase()
                ->letters()
                ->numbers()
                ->symbols()
                ->uncompromised()
            : null,
        );
    }
}
