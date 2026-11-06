<?php

declare(strict_types=1);

namespace App\Filament\Resources\Users\Tables;

use App\Enums\UserRole;
use App\Models\User;
use Filament\Actions\Action;
use Filament\Forms\Components\Select;
use Filament\Forms\Components\TextInput;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Filters\TernaryFilter;
use Filament\Tables\Table;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\Log;

final class UsersTable
{
    public static function configure(Table $table): Table
    {
        return $table
            ->columns([
                TextColumn::make('pilotProfile.callsign')->label('Позывной')->searchable(),
                TextColumn::make('email')->label('Почта')->searchable(),
                TextColumn::make('role')->label('Роль')->badge(),
                TextColumn::make('pilotProfile.missions_total')->label('Вылетов')->sortable(),
                TextColumn::make('banned_at')->label('Заблокирован')->dateTime()->placeholder('—'),
                TextColumn::make('ban_reason')->label('Причина')->limit(40)->placeholder('—'),
                TextColumn::make('created_at')->label('Регистрация')->date()->sortable(),
            ])
            ->defaultSort('created_at', 'desc')
            ->filters([
                TernaryFilter::make('banned')->label('Заблокированные')
                    ->queries(true: fn (Builder $q) => $q->whereNotNull('banned_at'), false: fn (Builder $q) => $q->whereNull('banned_at')),
            ])
            ->recordActions([
                Action::make('ban')->label('Заблокировать')->color('danger')
                    ->visible(fn (User $record): bool => $record->banned_at === null && ! $record->isAdmin())
                    ->schema([TextInput::make('reason')->label('Причина')->required()->maxLength(255)])
                    ->requiresConfirmation()
                    ->action(function (User $record, array $data): void {
                        $record->forceFill(['banned_at' => now(), 'ban_reason' => $data['reason']])->save();
                        Log::warning('user_banned', ['user_id' => $record->id, 'by' => auth()->id(), 'reason' => $data['reason']]);
                    }),
                Action::make('unban')->label('Разблокировать')
                    ->visible(fn (User $record): bool => $record->banned_at !== null)
                    ->requiresConfirmation()
                    ->action(fn (User $record) => $record->forceFill(['banned_at' => null, 'ban_reason' => null])->save()),
                Action::make('role')->label('Роль')
                    ->schema([Select::make('role')->label('Роль')->options(array_combine(UserRole::values(), UserRole::values()))->required()])
                    ->fillForm(fn (User $record): array => ['role' => $record->role->value])
                    ->action(fn (User $record, array $data) => $record->forceFill(['role' => UserRole::from($data['role'])])->save()),
            ]);
    }
}
