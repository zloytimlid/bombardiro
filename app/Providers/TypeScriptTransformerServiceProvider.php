<?php

declare(strict_types=1);

namespace App\Providers;

use Spatie\LaravelTypeScriptTransformer\LaravelData\LaravelDataTypeScriptTransformerExtension;
use Spatie\LaravelTypeScriptTransformer\TypeScriptTransformerApplicationServiceProvider as BaseTypeScriptTransformerServiceProvider;
use Spatie\TypeScriptTransformer\Transformers\EnumTransformer;
use Spatie\TypeScriptTransformer\TypeScriptTransformerConfigFactory;
use Spatie\TypeScriptTransformer\Writers\FlatModuleWriter;

/**
 * Сообщения протокола, которые проходят через сервер (раздел 16: Data/Net/*.php →
 * resources/js/types/generated/net.ts). Обновить: php artisan typescript:transform
 */
final class TypeScriptTransformerServiceProvider extends BaseTypeScriptTransformerServiceProvider
{
    protected function configure(TypeScriptTransformerConfigFactory $config): void
    {
        $config
            ->extension(new LaravelDataTypeScriptTransformerExtension)
            ->transformer(EnumTransformer::class)
            ->transformDirectories(app_path('Domain/FlightSessions/Data/Net'), app_path('Domain/Accounts/Data'))
            ->outputDirectory(resource_path('js/types/generated'))
            ->writer(new FlatModuleWriter('net.ts'))
            ->withoutManifest();
    }
}
