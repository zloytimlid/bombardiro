<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Domain\Campaigns\Actions\CampaignService;
use App\Domain\Campaigns\Models\Campaign;
use App\Domain\Campaigns\Models\CampaignProgress;
use App\Domain\Crews\Enums\CrewStatus;
use App\Domain\Crews\Models\Crew;
use App\Domain\Crews\Support\CrewRoster;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpKernel\Exception\ConflictHttpException;

/**
 * Кампания экипажа (этап 6): выбрать кампанию в лобби, день ремонта, выйти из кампании.
 */
final class CampaignApiController extends Controller
{
    public function __construct(private readonly CampaignService $campaigns) {}

    public function index(): JsonResponse
    {
        return response()->json(['data' => Campaign::query()->orderBy('id')->get(['slug', 'title', 'description', 'missions', 'placeholder'])]);
    }

    public function enroll(Request $request, Crew $crew): JsonResponse
    {
        $this->authorizeOwnerInLobby($crew);

        $data = $request->validate(['campaign' => ['required', 'string', 'exists:campaigns,slug']]);
        $campaign = Campaign::query()->where('slug', $data['campaign'])->firstOrFail();
        $progress = $this->campaigns->enroll($crew, $campaign);

        $crew->update(['campaign_progress_id' => $progress->id]);

        return response()->json(['data' => CrewRoster::of($crew->refresh())]);
    }

    public function leave(Crew $crew): JsonResponse
    {
        $this->authorizeOwnerInLobby($crew);
        $crew->update(['campaign_progress_id' => null]);

        return response()->json(['data' => CrewRoster::of($crew->refresh())]);
    }

    public function repair(Crew $crew): JsonResponse
    {
        $this->authorizeOwnerInLobby($crew);

        $progress = CampaignProgress::query()->findOrFail($crew->campaign_progress_id ?? 0);

        $this->campaigns->repairDay($progress);

        return response()->json(['data' => CrewRoster::of($crew->refresh())]);
    }

    private function authorizeOwnerInLobby(Crew $crew): void
    {
        abort_unless($crew->owner_id === $this->authUser()->id, 403, __('crew.error.not_owner'));

        if ($crew->status !== CrewStatus::Lobby) {
            throw new ConflictHttpException(__('crew.error.not_in_lobby'));
        }
    }
}
