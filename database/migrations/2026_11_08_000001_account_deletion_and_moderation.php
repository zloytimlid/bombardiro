<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Раздел 13, «Персональные данные»: удаление аккаунта стирает данные и обезличивает статистику —
 * вылеты экипажа остаются у остальных игроков. Модерация: блокировка игрока и разбор флагов вылета.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table): void {
            $table->timestamp('banned_at')->nullable()->index();
            $table->string('ban_reason', 255)->nullable();
        });

        Schema::table('flight_session_participants', function (Blueprint $table): void {
            $table->timestamp('anonymized_at')->nullable();
        });

        Schema::table('flight_sessions', function (Blueprint $table): void {
            $table->timestamp('reviewed_at')->nullable();
            $table->foreignId('reviewed_by')->nullable()->index()->constrained('users')->nullOnDelete();
            $table->string('review_decision', 16)->nullable();
        });

        // Владелец экипажа удалил аккаунт — экипаж и его вылеты остаются (владельца нет).
        Schema::table('crews', function (Blueprint $table): void {
            $table->dropForeign(['owner_id']);
        });
        Schema::table('crews', function (Blueprint $table): void {
            $table->foreignId('owner_id')->nullable()->change();
            $table->foreign('owner_id')->references('id')->on('users')->nullOnDelete();
        });

        DB::statement('ALTER TABLE flight_session_participants DROP CONSTRAINT participants_ai_check');
        DB::statement('ALTER TABLE flight_session_participants ADD CONSTRAINT participants_ai_check CHECK (is_ai OR user_id IS NOT NULL OR anonymized_at IS NOT NULL)');
        DB::statement("ALTER TABLE flight_sessions ADD CONSTRAINT flight_sessions_review_check CHECK (review_decision IS NULL OR review_decision IN ('accepted', 'rejected'))");
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE flight_sessions DROP CONSTRAINT flight_sessions_review_check');
        DB::statement('ALTER TABLE flight_session_participants DROP CONSTRAINT participants_ai_check');
        DB::statement('ALTER TABLE flight_session_participants ADD CONSTRAINT participants_ai_check CHECK (is_ai OR user_id IS NOT NULL)');

        Schema::table('crews', function (Blueprint $table): void {
            $table->dropForeign(['owner_id']);
        });
        Schema::table('crews', function (Blueprint $table): void {
            $table->foreignId('owner_id')->nullable(false)->change();
            $table->foreign('owner_id')->references('id')->on('users')->cascadeOnDelete();
        });

        Schema::table('flight_sessions', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('reviewed_by');
            $table->dropColumn(['reviewed_at', 'review_decision']);
        });

        Schema::table('flight_session_participants', function (Blueprint $table): void {
            $table->dropColumn('anonymized_at');
        });

        Schema::table('users', function (Blueprint $table): void {
            $table->dropColumn(['banned_at', 'ban_reason']);
        });
    }
};
