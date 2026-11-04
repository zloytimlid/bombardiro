<?php

return [
    /*
    | Требовать подтверждённую 2FA для входа в /admin (раздел 13 ТЗ).
    | Отключать только локально и в тестах.
    */
    'require_2fa' => (bool) env('ADMIN_REQUIRE_2FA', true),

    /*
    | Учётная запись администратора, которую создаёт DatabaseSeeder (только dev/CI).
    */
    'seed_email' => env('SEED_ADMIN_EMAIL', 'admin@lil-critter.test'),
    'seed_password' => env('SEED_ADMIN_PASSWORD'),
];
