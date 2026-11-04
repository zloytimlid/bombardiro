<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('theatres', function (Blueprint $table): void {
            $table->id();
            $table->string('slug', 64)->unique();
            $table->jsonb('name');
            $table->decimal('origin_lat', 9, 6);
            $table->decimal('origin_lon', 9, 6);
            $table->jsonb('bounds');
            $table->string('terrain_manifest_url')->nullable();
            // Параметры процедурного рельефа и полосы (resources/sim/theatres/*.json) до нарезки DEM.
            $table->jsonb('definition');
            $table->boolean('placeholder')->default(true);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('theatres');
    }
};
