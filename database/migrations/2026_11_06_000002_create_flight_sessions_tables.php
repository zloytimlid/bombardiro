<?php

declare(strict_types=1);

use App\Domain\Aircraft\Enums\Station;
use App\Domain\FlightSessions\Enums\FlightSessionStatus;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('flight_sessions', function (Blueprint $table): void {
            $table->id();
            $table->ulid('ulid')->unique();
            $table->foreignId('crew_id')->index()->constrained()->cascadeOnDelete();
            $table->foreignId('mission_id')->index()->constrained()->restrictOnDelete();
            // Вылет ссылается на конкретную версию миссии (раздел 10).
            $table->unsignedInteger('mission_version');
            $table->unsignedBigInteger('seed');
            $table->string('difficulty', 16);
            $table->string('status', 16)->index();
            $table->foreignId('host_user_id')->nullable()->index()->constrained('users')->nullOnDelete();
            $table->timestamp('started_at')->nullable();
            $table->timestamp('ended_at')->nullable();
            $table->string('outcome', 24)->nullable();
            $table->unsignedSmallInteger('score')->nullable();
            $table->boolean('verified')->default(false);
            $table->jsonb('flags')->default('[]');
            $table->jsonb('debrief')->nullable();
            $table->unsignedInteger('last_seq')->default(0);
            $table->timestamps();
        });

        Schema::create('flight_session_participants', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('flight_session_id')->index()->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->nullable()->index()->constrained()->nullOnDelete();
            $table->string('seat', 16);
            $table->boolean('is_ai');
            $table->timestamp('joined_at');
            $table->timestamp('left_at')->nullable();
            $table->jsonb('metrics')->nullable();
        });

        // Журнал событий вылета (раздел 9.3). Хранение 90 дней — ежедневная очистка (sessions:prune).
        Schema::create('flight_session_events', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('flight_session_id')->index()->constrained()->cascadeOnDelete();
            $table->unsignedInteger('seq');
            $table->unsignedInteger('tick');
            $table->string('type', 48);
            $table->jsonb('payload');
            $table->timestamp('created_at')->index();
            $table->unique(['flight_session_id', 'seq']);
        });

        $statuses = implode("', '", FlightSessionStatus::values());
        $seats = implode("', '", Station::values());

        DB::statement("ALTER TABLE flight_sessions ADD CONSTRAINT flight_sessions_status_check CHECK (status IN ('{$statuses}'))");
        DB::statement("ALTER TABLE flight_sessions ADD CONSTRAINT flight_sessions_difficulty_check CHECK (difficulty IN ('training', 'historical'))");
        DB::statement("ALTER TABLE flight_session_participants ADD CONSTRAINT participants_seat_check CHECK (seat IN ('{$seats}'))");
        DB::statement('ALTER TABLE flight_session_participants ADD CONSTRAINT participants_ai_check CHECK (is_ai OR user_id IS NOT NULL)');
    }

    public function down(): void
    {
        Schema::dropIfExists('flight_session_events');
        Schema::dropIfExists('flight_session_participants');
        Schema::dropIfExists('flight_sessions');
    }
};
