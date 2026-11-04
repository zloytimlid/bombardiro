<?php

declare(strict_types=1);

use App\Domain\Aircraft\Enums\Station;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('pilot_profiles', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('user_id')->unique()->constrained()->cascadeOnDelete();
            $table->string('callsign', 24)->unique();
            $table->string('rank', 32)->default('second_lieutenant');
            $table->unsignedInteger('missions_total')->default(0);
            $table->unsignedBigInteger('flight_seconds_total')->default(0);
            $table->string('preferred_seat', 16)->nullable();
            $table->timestamps();
        });

        if (DB::getDriverName() === 'pgsql') {
            $seats = implode("','", Station::values());
            DB::statement("ALTER TABLE pilot_profiles ADD CONSTRAINT pilot_profiles_preferred_seat_check CHECK (preferred_seat IS NULL OR preferred_seat IN ('{$seats}'))");
            // Позывной уникален без учёта регистра.
            DB::statement('CREATE UNIQUE INDEX pilot_profiles_callsign_lower_unique ON pilot_profiles (LOWER(callsign))');
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('pilot_profiles');
    }
};
