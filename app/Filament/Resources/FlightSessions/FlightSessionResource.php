<?php

declare(strict_types=1);

namespace App\Filament\Resources\FlightSessions;

use App\Domain\FlightSessions\Enums\FlightSessionStatus;
use App\Domain\FlightSessions\Models\FlightSession;
use App\Filament\Resources\FlightSessions\Pages\ListFlightSessions;
use BackedEnum;
use Filament\Actions\Action;
use Filament\Resources\Resource;
use Filament\Support\Icons\Heroicon;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Filters\TernaryFilter;
use Filament\Tables\Table;
use Illuminate\Database\Eloquent\Builder;

/**
 * Модерация вылетов (раздел 9.3): сервер помечает невозможное флагами — модератор принимает результат
 * (вылет идёт в рейтинги) или отклоняет. Решение и модератор сохраняются.
 */
final class FlightSessionResource extends Resource
{
    protected static ?string $model = FlightSession::class;

    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedFlag;

    protected static ?string $modelLabel = 'вылет';

    protected static ?string $pluralModelLabel = 'вылеты';

    public static function table(Table $table): Table
    {
        return $table
            ->columns([
                TextColumn::make('ulid')->label('Вылет')->limit(10)->searchable(),
                TextColumn::make('mission.slug')->label('Миссия'),
                TextColumn::make('crew.name')->label('Экипаж')->searchable(),
                TextColumn::make('status')->label('Статус')->badge(),
                TextColumn::make('outcome')->label('Итог')->placeholder('—'),
                TextColumn::make('score')->label('Оценка')->sortable()->placeholder('—'),
                TextColumn::make('flags')->label('Флаги')->badge()->color('danger')->placeholder('—'),
                TextColumn::make('review_decision')->label('Решение')->badge()->placeholder('—'),
                TextColumn::make('ended_at')->label('Окончен')->dateTime()->sortable(),
            ])
            ->defaultSort('ended_at', 'desc')
            ->filters([
                TernaryFilter::make('flagged')->label('С флагами')->default(true)
                    ->queries(true: fn (Builder $q) => $q->where('verified', false)->where('status', FlightSessionStatus::Finished), false: fn (Builder $q) => $q->where('verified', true)),
            ])
            ->recordActions([
                Action::make('accept')->label('Принять')->color('success')
                    ->visible(fn (FlightSession $record): bool => ! $record->verified && $record->status === FlightSessionStatus::Finished)
                    ->requiresConfirmation()
                    ->action(fn (FlightSession $record) => $record->forceFill(['verified' => true, 'review_decision' => 'accepted', 'reviewed_at' => now(), 'reviewed_by' => auth()->id()])->save()),
                Action::make('reject')->label('Отклонить')->color('danger')
                    ->visible(fn (FlightSession $record): bool => $record->review_decision === null && $record->status === FlightSessionStatus::Finished)
                    ->requiresConfirmation()
                    ->action(fn (FlightSession $record) => $record->forceFill(['verified' => false, 'review_decision' => 'rejected', 'reviewed_at' => now(), 'reviewed_by' => auth()->id()])->save()),
            ]);
    }

    public static function canCreate(): bool
    {
        return false;
    }

    public static function getPages(): array
    {
        return [
            'index' => ListFlightSessions::route('/'),
        ];
    }
}
