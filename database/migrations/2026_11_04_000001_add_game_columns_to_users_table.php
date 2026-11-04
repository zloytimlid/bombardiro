<?php

declare(strict_types=1);

use App\Enums\UserRole;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table): void {
            $table->string('locale', 5)->default('ru')->after('password');
            $table->string('role', 16)->default(UserRole::Player->value)->index()->after('locale');
            $table->jsonb('settings')->default('{}')->after('role');
        });

        if (DB::getDriverName() === 'pgsql') {
            $roles = implode("','", UserRole::values());
            DB::statement("ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('{$roles}'))");
            DB::statement("ALTER TABLE users ADD CONSTRAINT users_locale_check CHECK (locale IN ('ru','en'))");
        }
    }

    public function down(): void
    {
        if (DB::getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check');
            DB::statement('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_locale_check');
        }

        Schema::table('users', function (Blueprint $table): void {
            $table->dropIndex(['role']);
            $table->dropColumn(['locale', 'role', 'settings']);
        });
    }
};
