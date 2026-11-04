<?php

// Границы модулей (раздел 5): Domain не зависит от Http, контроллеры тонкие.

arch('domain does not depend on the HTTP layer')
    ->expect('App\Domain')
    ->not->toUse(['App\Http', 'Illuminate\Http\Request', 'Inertia']);

arch('domain does not depend on the admin panel')
    ->expect('App\Domain')
    ->not->toUse('App\Filament');

arch('enums are backed')
    ->expect(['App\Enums', 'App\Domain\Aircraft\Enums'])
    ->toBeStringBackedEnums();

arch('no debugging leftovers')
    ->expect(['dd', 'dump', 'ray', 'var_dump', 'die'])
    ->not->toBeUsed();

arch('domain actions are final')
    ->expect('App\Domain\*\Actions')
    ->classes()
    ->toBeFinal();
