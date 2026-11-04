<?php

namespace Database\Seeders;

use App\Enums\UserRole;
use App\Models\User;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;
use Illuminate\Support\Str;

class DatabaseSeeder extends Seeder
{
    use WithoutModelEvents;

    /**
     * Тестовые пользователи (раздел 10). Театр, B-25J и миссии добавляются сидерами этапов 1–2.
     */
    public function run(): void
    {
        $configuredPassword = config('admin.seed_password');
        $adminPassword = is_string($configuredPassword) && $configuredPassword !== '' ? $configuredPassword : Str::password(20);

        $admin = User::query()->updateOrCreate(
            ['email' => (string) config('admin.seed_email')],
            ['name' => 'Admin', 'password' => $adminPassword, 'email_verified_at' => now()],
        );
        $admin->forceFill(['role' => UserRole::Admin])->save();
        $admin->pilotProfile()->firstOrCreate([], ['callsign' => 'Skipper']);

        if ($adminPassword !== $configuredPassword) {
            $this->command?->warn("Admin {$admin->email}: сгенерирован пароль {$adminPassword} (задайте SEED_ADMIN_PASSWORD в .env)");
        }

        if (User::query()->where('email', 'like', 'crew%@lil-critter.test')->doesntExist()) {
            foreach (range(1, 3) as $i) {
                User::factory()->withPilotProfile("Crew{$i}")->create([
                    'name' => "Crew {$i}",
                    'email' => "crew{$i}@lil-critter.test",
                ]);
            }
        }
    }
}
