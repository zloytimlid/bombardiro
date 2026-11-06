<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Domain\Accounts\Actions\AccountService;
use App\Domain\Accounts\Data\UserSettingsData;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * /api/me/* (раздел 11): настройки управления, графики, звука и доступности; выгрузка своих данных.
 */
final class AccountApiController extends Controller
{
    public function __construct(private readonly AccountService $accounts) {}

    public function settings(): JsonResponse
    {
        return response()->json(['data' => $this->accounts->settings($this->authUser())]);
    }

    public function saveSettings(Request $request): JsonResponse
    {
        $current = $this->accounts->settings($this->authUser())->toArray();
        $settings = UserSettingsData::validateAndCreate([...$current, ...$request->all()]);

        return response()->json(['data' => $this->accounts->saveSettings($this->authUser(), $settings)]);
    }

    public function export(): JsonResponse
    {
        return response()->json($this->accounts->export($this->authUser()))
            ->header('Content-Disposition', 'attachment; filename="lil-critter-my-data.json"');
    }
}
