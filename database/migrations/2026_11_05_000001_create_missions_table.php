<?php

declare(strict_types=1);

use App\Domain\Missions\Enums\MissionDifficulty;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('missions', function (Blueprint $table): void {
            $table->id();
            $table->string('slug', 96);
            $table->unsignedInteger('version');
            $table->jsonb('title');
            $table->foreignId('theatre_id')->index()->constrained()->restrictOnDelete();
            $table->date('historical_date')->nullable();
            $table->string('difficulty', 16);
            // Полное описание миссии (раздел 8.3), валидируется по resources/sim/schemas/mission.schema.json.
            $table->jsonb('definition');
            $table->boolean('is_published')->default(false);
            $table->boolean('placeholder')->default(true);
            $table->jsonb('sources');
            $table->timestamps();

            // Правка опубликованной миссии = новая версия (раздел 10).
            $table->unique(['slug', 'version']);
        });

        $values = implode("', '", MissionDifficulty::values());

        DB::statement("ALTER TABLE missions ADD CONSTRAINT missions_difficulty_check CHECK (difficulty IN ('{$values}'))");
        DB::statement('ALTER TABLE missions ADD CONSTRAINT missions_version_check CHECK (version > 0)');
    }

    public function down(): void
    {
        Schema::dropIfExists('missions');
    }
};
