<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Domain\Aircraft\Enums\Station;
use App\Domain\Crews\Actions\CrewActions;
use App\Domain\Crews\Enums\CrewVisibility;
use App\Domain\Crews\Models\CrewMember;
use App\Domain\FlightSessions\Actions\FlightSessionService;
use App\Domain\Missions\Models\Mission;
use App\Models\User;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\File;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

/**
 * Данные для нагрузочного прогона k6 (раздел 14): N экипажей по 8 игроков, вылеты начаты.
 * Пишет storage/app/k6/fixture.json — список вылетов с почтой хоста и игроков.
 *
 * Только вне продакшена: пользователи load*@lil-critter.test с паролем фабрики «password».
 */
#[Signature('load:prepare {crews=20 : Сколько экипажей} {--mission=milk-run : Миссия}')]
#[Description('Готовит экипажи и вылеты для k6 (load/k6-coop.js)')]
final class PrepareLoadTest extends Command
{
    public function handle(CrewActions $crews, FlightSessionService $sessions): int
    {
        if (app()->isProduction()) {
            $this->error('Не для продакшена.');

            return self::FAILURE;
        }

        $mission = Mission::latestPublished((string) $this->option('mission'));

        if ($mission === null) {
            $this->error('Миссия не найдена — выполните sim:sync.');

            return self::FAILURE;
        }

        $count = max(1, (int) $this->argument('crews'));
        $fixture = [];

        foreach (range(1, $count) as $c) {
            $users = [];

            foreach (Station::cases() as $i => $seat) {
                $email = sprintf('load%02d-%d@lil-critter.test', $c, $i + 1);
                $users[] = User::query()->where('email', $email)->first()
                    ?? User::factory()->withPilotProfile(sprintf('L%02d-%d', $c, $i + 1))->create(['name' => "Load {$c}-".($i + 1), 'email' => $email]);
            }

            // Из прошлых прогонов: выйти из старых экипажей, чтобы снова занять места.
            foreach ($users as $user) {
                foreach (CrewMember::query()->where('user_id', $user->id)->with('crew')->get() as $membership) {
                    try {
                        $crews->leave($membership->crew, $user);
                    } catch (HttpExceptionInterface) {
                        // Экипаж уже закрыт или в вылете — не мешает новому.
                    }
                }
            }

            $crew = $crews->create($users[0], $mission, CrewVisibility::Private, 8, "Load {$c}");

            foreach (Station::cases() as $i => $seat) {
                if ($i > 0) {
                    $crews->join($users[$i], $crew->invite_code);
                }

                $crews->claimSeat($crew->refresh(), $users[$i], $seat);
                $crews->setReady($crew->refresh(), $users[$i], true);
            }

            $session = $sessions->start($crew->refresh(), $users[0]);
            $host = collect($users)->firstWhere('id', $session->host_user_id) ?? $users[0];

            $fixture[] = [
                'session' => $session->ulid,
                'crew' => $crew->ulid,
                'host' => $host->email,
                'members' => array_map(fn (User $u): string => $u->email, $users),
            ];
        }

        File::ensureDirectoryExists(storage_path('app/k6'));
        File::put(storage_path('app/k6/fixture.json'), json_encode($fixture, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR));

        $this->info(sprintf('Готово: %d экипажей × 8 → storage/app/k6/fixture.json', $count));

        return self::SUCCESS;
    }
}
