<?php

namespace App\Concerns;

use App\Domain\Progression\Models\PilotProfile;
use App\Models\User;
use Closure;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Unique;

trait ProfileValidationRules
{
    /**
     * Get the validation rules used to validate user profiles.
     *
     * @return array<string, array<int, Unique|ValidationRule|array<mixed>|string>>
     */
    protected function profileRules(?int $userId = null): array
    {
        return [
            'name' => $this->nameRules(),
            'email' => $this->emailRules($userId),
        ];
    }

    /**
     * Get the validation rules used to validate user names.
     *
     * @return array<int, Unique|ValidationRule|array<mixed>|string>
     */
    protected function nameRules(): array
    {
        return ['required', 'string', 'max:255'];
    }

    /**
     * Позывной пилота: уникален без учёта регистра.
     *
     * @return array<int, ValidationRule|Closure|string>
     */
    protected function callsignRules(?int $ignoreUserId = null): array
    {
        return [
            'required',
            'string',
            'min:3',
            'max:24',
            'regex:/^[A-Za-z0-9_-]+$/',
            function (string $attribute, mixed $value, Closure $fail) use ($ignoreUserId): void {
                $taken = PilotProfile::query()
                    ->whereRaw('LOWER(callsign) = ?', [mb_strtolower((string) $value)])
                    ->when($ignoreUserId !== null, fn ($q) => $q->where('user_id', '!=', $ignoreUserId))
                    ->exists();

                if ($taken) {
                    $fail(__('validation.unique', ['attribute' => $attribute]));
                }
            },
        ];
    }

    /**
     * Get the validation rules used to validate user emails.
     *
     * @return array<int, Unique|ValidationRule|array<mixed>|string>
     */
    protected function emailRules(?int $userId = null): array
    {
        return [
            'required',
            'string',
            'email',
            'max:255',
            $userId === null
                ? Rule::unique(User::class)
                : Rule::unique(User::class)->ignore($userId),
        ];
    }
}
