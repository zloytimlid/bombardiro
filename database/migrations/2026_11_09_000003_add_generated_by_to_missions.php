<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Генератор миссий (раздел 8.5, этап 6): сгенерированная миссия — черновик игрока, в каталог не попадает,
 * но доступна его экипажам. Проверяется той же JSON Schema, что и миссии из resources/sim.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('missions', function (Blueprint $table): void {
            $table->foreignId('generated_by')->nullable()->index()->constrained('users')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('missions', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('generated_by');
        });
    }
};
