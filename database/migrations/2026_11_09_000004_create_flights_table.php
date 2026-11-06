<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Звено до 4 экипажей (этап 6): одна миссия и сид на всех, у каждого самолёта — свой хост и канал вылета;
 * положение самолётов звена — по каналу presence-flight.{flight}. Место в строю — flight_slot (0 — ведущий).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('flights', function (Blueprint $table): void {
            $table->id();
            $table->ulid('ulid')->unique();
            $table->char('invite_code', 8)->unique();
            $table->foreignId('leader_crew_id')->index()->constrained('crews')->cascadeOnDelete();
            $table->foreignId('mission_id')->index()->constrained()->restrictOnDelete();
            $table->string('status', 16)->default('lobby');
            $table->unsignedBigInteger('seed')->nullable();
            $table->timestamps();
        });

        DB::statement("ALTER TABLE flights ADD CONSTRAINT flights_status_check CHECK (status IN ('lobby', 'in_session', 'closed'))");

        Schema::table('crews', function (Blueprint $table): void {
            $table->foreignId('flight_id')->nullable()->index()->constrained()->nullOnDelete();
            $table->unsignedSmallInteger('flight_slot')->nullable();
            $table->unique(['flight_id', 'flight_slot']);
        });

        Schema::table('flight_sessions', function (Blueprint $table): void {
            $table->foreignId('flight_id')->nullable()->index()->constrained()->nullOnDelete();
            $table->unsignedSmallInteger('flight_slot')->nullable();
        });

        DB::statement('ALTER TABLE crews ADD CONSTRAINT crews_flight_slot_check CHECK (flight_slot IS NULL OR flight_slot BETWEEN 0 AND 3)');
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE crews DROP CONSTRAINT crews_flight_slot_check');

        Schema::table('flight_sessions', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('flight_id');
            $table->dropColumn('flight_slot');
        });

        Schema::table('crews', function (Blueprint $table): void {
            $table->dropUnique(['flight_id', 'flight_slot']);
            $table->dropConstrainedForeignId('flight_id');
            $table->dropColumn('flight_slot');
        });

        Schema::dropIfExists('flights');
    }
};
