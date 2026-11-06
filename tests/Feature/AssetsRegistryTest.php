<?php

declare(strict_types=1);

use App\Support\AssetRegistry;
use Illuminate\Support\Facades\Process;

/**
 * Критерий этапа 4: все ассеты есть в docs/assets.md с лицензией.
 * Ассеты — картинки, звуки, шрифты, модели в репозитории (git ls-files).
 */
it('lists every asset file of the repository with a source and a license', function (): void {
    $result = Process::path(base_path())->run(['git', 'ls-files', 'public', 'resources']);

    if (! $result->successful()) {
        $this->markTestSkipped('git недоступен');
    }

    $assets = array_values(array_filter(
        preg_split('/\R/', trim($result->output())) ?: [],
        fn (string $f): bool => preg_match('/\.(png|jpe?g|webp|gif|svg|ico|mp3|ogg|wav|m4a|glb|gltf|woff2?|ttf|otf)$/i', $f) === 1,
    ));
    $entries = AssetRegistry::entries();
    $paths = array_column($entries, 'path');

    expect($assets)->not->toBeEmpty();

    foreach ($assets as $file) {
        expect($paths)->toContain($file);
    }

    foreach ($entries as $entry) {
        expect($entry['source'])->not->toBe('')
            ->and($entry['license'])->not->toBe('')
            ->and($entry['license'])->not->toBe('—');
    }
});

it('shows the attributions on the About page', function (): void {
    $this->get(route('about'))->assertOk()
        ->assertInertia(fn ($page) => $page->component('About')
            ->where('assets', fn ($assets) => collect($assets)->contains(fn (array $a): bool => str_contains($a['license'], 'Open Font License'))));
});
