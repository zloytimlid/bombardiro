<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Повторы вылетов (раздел 10, этап 6): журнал и трек одним файлом в S3; хранение 30 дней, если не закреплён.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('flight_session_replays', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('flight_session_id')->unique()->constrained()->cascadeOnDelete();
            $table->string('storage_path', 255);
            $table->unsignedBigInteger('bytes');
            $table->unsignedSmallInteger('format_version');
            $table->boolean('pinned')->default(false);
            $table->timestamps();
            $table->index(['pinned', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('flight_session_replays');
    }
};
