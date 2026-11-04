<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('aircraft_types', function (Blueprint $table): void {
            $table->id();
            $table->string('slug', 32)->unique();
            $table->string('name');
            // config = содержимое resources/sim/aircraft/{slug}.json (раздел 10).
            $table->jsonb('config');
            $table->unsignedInteger('config_version');
            $table->timestamps();
        });

        Schema::create('airframes', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('aircraft_type_id')->constrained()->restrictOnDelete();
            $table->string('serial', 32)->unique();
            $table->string('name');
            $table->string('livery', 64)->nullable();
            // Повреждения и износ для кампании (этап 6).
            $table->jsonb('state')->default('{}');
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('airframes');
        Schema::dropIfExists('aircraft_types');
    }
};
