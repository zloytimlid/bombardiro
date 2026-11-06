<?php

declare(strict_types=1);

use App\Domain\Aircraft\Enums\Station;
use App\Domain\Crews\Enums\CrewStatus;
use App\Domain\Crews\Enums\CrewVisibility;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('crews', function (Blueprint $table): void {
            $table->id();
            $table->ulid('ulid')->unique();
            $table->string('name', 64);
            $table->foreignId('owner_id')->index()->constrained('users')->cascadeOnDelete();
            $table->char('invite_code', 8)->unique();
            $table->string('visibility', 16);
            $table->unsignedSmallInteger('max_players');
            $table->string('status', 16);
            $table->foreignId('mission_id')->index()->constrained()->restrictOnDelete();
            $table->string('difficulty', 16)->default('training');
            // Хост, выбранный владельцем в лобби; null — по наименьшему RTT (раздел 9.1).
            $table->foreignId('host_user_id')->nullable()->index()->constrained('users')->nullOnDelete();
            $table->timestamps();
        });

        Schema::create('crew_members', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('crew_id')->index()->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->index()->constrained()->cascadeOnDelete();
            $table->string('seat', 16)->nullable();
            $table->boolean('is_ready')->default(false);
            $table->unsignedInteger('rtt_ms')->nullable();
            $table->timestamp('last_seen_at')->nullable();
            $table->timestamp('joined_at');
            $table->unique(['crew_id', 'user_id']);
        });

        $statuses = implode("', '", CrewStatus::values());
        $visibility = implode("', '", CrewVisibility::values());
        $seats = implode("', '", Station::values());

        DB::statement("ALTER TABLE crews ADD CONSTRAINT crews_status_check CHECK (status IN ('{$statuses}'))");
        DB::statement("ALTER TABLE crews ADD CONSTRAINT crews_visibility_check CHECK (visibility IN ('{$visibility}'))");
        DB::statement('ALTER TABLE crews ADD CONSTRAINT crews_max_players_check CHECK (max_players BETWEEN 1 AND 8)');
        DB::statement("ALTER TABLE crews ADD CONSTRAINT crews_difficulty_check CHECK (difficulty IN ('training', 'historical'))");
        DB::statement("ALTER TABLE crew_members ADD CONSTRAINT crew_members_seat_check CHECK (seat IS NULL OR seat IN ('{$seats}'))");
        // Одно место — один игрок: частичный уникальный индекс (раздел 10).
        DB::statement('CREATE UNIQUE INDEX crew_members_crew_seat_unique ON crew_members (crew_id, seat) WHERE seat IS NOT NULL');
    }

    public function down(): void
    {
        Schema::dropIfExists('crew_members');
        Schema::dropIfExists('crews');
    }
};
