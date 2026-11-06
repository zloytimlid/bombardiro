<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Support\AssetRegistry;
use Inertia\Inertia;
use Inertia\Response;

/**
 * «О проекте» (раздел 13): атрибуции ассетов из docs/assets.md, допущения и источники.
 */
final class AboutController extends Controller
{
    public function __invoke(): Response
    {
        return Inertia::render('About', ['assets' => AssetRegistry::entries()]);
    }
}
