<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Кампания (раздел 10, этап 6): последовательность миссий, состояние борта и экипажа между вылетами.
 * Повреждения сохраняются и требуют времени на ремонт (раздел 7.3).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('campaigns', function (Blueprint $table): void {
            $table->id();
            $table->string('slug', 64)->unique();
            $table->jsonb('title');
            $table->jsonb('description');
            $table->jsonb('missions');
            $table->jsonb('rules');
            $table->boolean('placeholder')->default(true);
            $table->timestamps();
        });

        Schema::create('campaign_progress', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('campaign_id')->index()->constrained()->cascadeOnDelete();
            $table->foreignId('crew_id')->index()->constrained()->cascadeOnDelete();
            $table->unsignedSmallInteger('step')->default(0);
            $table->unsignedSmallInteger('day')->default(1);
            $table->jsonb('airframe_state');
            $table->jsonb('crew_state');
            $table->jsonb('history');
            $table->timestamp('completed_at')->nullable();
            $table->timestamps();
            $table->unique(['campaign_id', 'crew_id']);
        });

        Schema::table('flight_sessions', function (Blueprint $table): void {
            $table->foreignId('campaign_progress_id')->nullable()->index()->constrained('campaign_progress')->nullOnDelete();
        });

        // Экипаж летает кампанию: текущий прогресс (миссия экипажа = шаг кампании).
        Schema::table('crews', function (Blueprint $table): void {
            $table->foreignId('campaign_progress_id')->nullable()->index()->constrained('campaign_progress')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('crews', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('campaign_progress_id');
        });
        Schema::table('flight_sessions', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('campaign_progress_id');
        });
        Schema::dropIfExists('campaign_progress');
        Schema::dropIfExists('campaigns');
    }
};
