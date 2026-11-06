<?php

declare(strict_types=1);

namespace App\Domain\Accounts\Actions;

use App\Domain\Accounts\Models\SocialAccount;
use App\Domain\Progression\Actions\CreatePilotProfile;
use App\Domain\Progression\Models\PilotProfile;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Socialite\Contracts\User as ProviderUser;

/**
 * Вход через Discord / Google (этап 5). Связка по id провайдера; первый вход — по подтверждённой почте
 * существующего аккаунта или новый игрок с позывным из имени (уникальность — суффиксом).
 */
final readonly class SocialLogin
{
    public const array PROVIDERS = ['discord', 'google'];

    public function __construct(private CreatePilotProfile $profiles) {}

    public static function enabled(string $provider): bool
    {
        return in_array($provider, self::PROVIDERS, true)
            && is_string(config("services.{$provider}.client_id")) && config("services.{$provider}.client_id") !== ''
            && is_string(config("services.{$provider}.client_secret")) && config("services.{$provider}.client_secret") !== '';
    }

    /**
     * @return list<string>
     */
    public static function available(): array
    {
        return array_values(array_filter(self::PROVIDERS, self::enabled(...)));
    }

    public function resolve(string $provider, ProviderUser $external): User
    {
        return DB::transaction(function () use ($provider, $external): User {
            $linked = SocialAccount::query()->where('provider', $provider)->where('provider_id', (string) $external->getId())->first();

            if ($linked !== null) {
                return $linked->user;
            }

            $email = $external->getEmail();
            $user = is_string($email) && $email !== '' ? User::query()->where('email', $email)->first() : null;

            if ($user === null) {
                $user = User::query()->create([
                    'name' => Str::limit($external->getName() ?? $external->getNickname() ?? 'Pilot', 60, ''),
                    'email' => is_string($email) && $email !== '' ? $email : "{$provider}-{$external->getId()}@users.invalid",
                    'password' => Str::password(40),
                ]);
                // Почту подтвердил провайдер.
                $user->forceFill(['email_verified_at' => now()])->save();
                $this->profiles->handle($user, $this->callsign($external->getNickname() ?? $external->getName() ?? 'Pilot'));
            }

            SocialAccount::query()->create(['user_id' => $user->id, 'provider' => $provider, 'provider_id' => (string) $external->getId()]);

            return $user;
        });
    }

    private function callsign(string $seed): string
    {
        $base = Str::limit(preg_replace('/[^A-Za-z0-9_-]/', '', Str::ascii($seed)) ?: 'Pilot', 18, '');
        $base = strlen($base) < 3 ? 'Pilot' : $base;
        $candidate = $base;

        for ($i = 2; PilotProfile::query()->whereRaw('LOWER(callsign) = ?', [strtolower($candidate)])->exists(); $i++) {
            $candidate = $base.$i;
        }

        return $candidate;
    }
}
