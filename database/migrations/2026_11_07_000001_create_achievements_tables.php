<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Достижения (раздел 10): каталог с декларативными условиями и выданные игрокам.
 * flight_sessions.awarded_at — вылет уже учтён в статистике и достижениях (повтор задачи безопасен).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('achievements', function (Blueprint $table): void {
            $table->id();
            $table->string('slug', 64)->unique();
            $table->jsonb('title');
            $table->jsonb('description');
            $table->jsonb('criteria');
            $table->string('icon', 32);
            $table->unsignedSmallInteger('sort')->default(0);
            $table->timestamps();
        });

        Schema::create('user_achievements', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('user_id')->index()->constrained()->cascadeOnDelete();
            $table->foreignId('achievement_id')->index()->constrained()->cascadeOnDelete();
            $table->foreignId('flight_session_id')->nullable()->index()->constrained()->nullOnDelete();
            $table->timestamp('unlocked_at');
            $table->unique(['user_id', 'achievement_id']);
        });

        Schema::table('flight_sessions', function (Blueprint $table): void {
            $table->timestamp('awarded_at')->nullable();
            $table->index(['status', 'verified', 'mission_id', 'score']);
        });
    }

    public function down(): void
    {
        Schema::table('flight_sessions', function (Blueprint $table): void {
            $table->dropIndex(['status', 'verified', 'mission_id', 'score']);
            $table->dropColumn('awarded_at');
        });
        Schema::dropIfExists('user_achievements');
        Schema::dropIfExists('achievements');
    }
};
