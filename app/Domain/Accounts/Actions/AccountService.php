<?php

declare(strict_types=1);

namespace App\Domain\Accounts\Actions;

use App\Domain\Accounts\Data\UserSettingsData;
use App\Domain\Crews\Models\CrewMember;
use App\Domain\FlightSessions\Models\FlightSessionParticipant;
use App\Domain\Progression\Models\UserAchievement;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Персональные данные (раздел 13): минимум данных, выгрузка своих данных, удаление аккаунта
 * с обезличиванием статистики — вылеты экипажа остаются у остальных, место игрока становится «удалённым».
 */
final class AccountService
{
    public function settings(User $user): UserSettingsData
    {
        return UserSettingsData::withDefaults($user->settings);
    }

    public function saveSettings(User $user, UserSettingsData $settings): UserSettingsData
    {
        $user->forceFill(['settings' => $settings->toArray()])->save();

        return $settings;
    }

    /**
     * @return array<string, mixed>
     */
    public function export(User $user): array
    {
        $profile = $user->pilotProfile;

        return [
            'exported_at' => now()->toIso8601String(),
            'account' => ['name' => $user->name, 'email' => $user->email, 'locale' => $user->locale, 'created_at' => $user->created_at?->toIso8601String()],
            'profile' => $profile === null ? null : [
                'callsign' => $profile->callsign,
                'rank' => $profile->rank,
                'missions_total' => $profile->missions_total,
                'flight_seconds_total' => $profile->flight_seconds_total,
                'preferred_seat' => $profile->preferred_seat?->value,
            ],
            'settings' => $this->settings($user)->toArray(),
            'crews' => CrewMember::query()->with('crew')->where('user_id', $user->id)->get()->map(fn (CrewMember $m): array => [
                'crew' => $m->crew->ulid,
                'name' => $m->crew->name,
                'seat' => $m->seat?->value,
                'joined_at' => $m->joined_at->toIso8601String(),
            ])->all(),
            'sorties' => FlightSessionParticipant::query()->with('session.mission')->where('user_id', $user->id)->orderBy('id')->get()->map(fn (FlightSessionParticipant $p): array => [
                'session' => $p->session->ulid,
                'mission' => $p->session->mission->slug,
                'seat' => $p->seat->value,
                'joined_at' => $p->joined_at->toIso8601String(),
                'left_at' => $p->left_at?->toIso8601String(),
                'outcome' => $p->session->outcome,
                'score' => $p->session->score,
                'metrics' => $p->metrics,
            ])->all(),
            'achievements' => UserAchievement::query()->with('achievement')->where('user_id', $user->id)->get()->map(fn (UserAchievement $a): array => [
                'slug' => $a->achievement->slug,
                'unlocked_at' => $a->unlocked_at->toIso8601String(),
            ])->all(),
        ];
    }

    /** Удалить аккаунт: участие в вылетах обезличивается, остальное стирается каскадом. */
    public function delete(User $user): void
    {
        DB::transaction(function () use ($user): void {
            FlightSessionParticipant::query()->where('user_id', $user->id)->update(['user_id' => null, 'anonymized_at' => now()]);
            $user->delete();
        });
    }
}
