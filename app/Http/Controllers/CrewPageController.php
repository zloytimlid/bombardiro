<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Domain\Crews\Models\Crew;
use App\Domain\Crews\Support\CrewRoster;
use App\Domain\FlightSessions\Enums\FlightSessionStatus;
use App\Domain\FlightSessions\Models\FlightSession;
use Inertia\Inertia;
use Inertia\Response;

/**
 * Страницы кооператива (раздел 11): лобби, игровой клиент, разбор.
 */
final class CrewPageController extends Controller
{
    public function lobby(Crew $crew): Response
    {
        abort_unless($crew->hasMember($this->authUser()), 403);

        $active = $crew->sessions()->whereIn('status', [FlightSessionStatus::Briefing, FlightSessionStatus::Active])->latest('id')->first();

        return Inertia::render('crews/Lobby', [
            'crew' => CrewRoster::of($crew),
            'activeSession' => $active?->ulid,
            'userId' => $this->authUser()->id,
        ]);
    }

    public function play(FlightSession $session): Response
    {
        abort_unless($session->crew->hasMember($this->authUser()), 403);

        return Inertia::render('play/Session', ['session' => $session->ulid, 'crew' => $session->crew->ulid]);
    }

    public function debrief(FlightSession $session): Response
    {
        abort_unless($session->crew->hasMember($this->authUser()) || $session->isParticipant($this->authUser()), 403);

        return Inertia::render('debrief/Session', ['session' => $session->ulid, 'crew' => $session->crew->ulid]);
    }
}
