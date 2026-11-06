<x-pulse::card :cols="$cols" :rows="$rows" :class="$class">
    <x-pulse::card-header name="Клиенты: FPS и RTT" title="Время: {{ number_format($time) }} мс; {{ $runAt }}">
        <x-slot:icon><x-pulse::icons.computer-desktop /></x-slot:icon>
    </x-pulse::card-header>
    <x-pulse::scroll :expand="$expand">
        @if ($fps->isEmpty() && $rtt->isEmpty())
            <x-pulse::no-results />
        @else
            <x-pulse::table>
                <x-pulse::thead>
                    <tr>
                        <x-pulse::th>Пресет / режим</x-pulse::th>
                        <x-pulse::th class="text-right">Среднее</x-pulse::th>
                        <x-pulse::th class="text-right">Мин / макс</x-pulse::th>
                        <x-pulse::th class="text-right">Замеров</x-pulse::th>
                    </tr>
                </x-pulse::thead>
                <tbody>
                    @foreach ($fps as $row)
                        <tr>
                            <x-pulse::td>FPS · {{ $row->key }}</x-pulse::td>
                            <x-pulse::td numeric>{{ round($row->avg) }}</x-pulse::td>
                            <x-pulse::td numeric>{{ round($row->min) }}</x-pulse::td>
                            <x-pulse::td numeric>{{ $row->count }}</x-pulse::td>
                        </tr>
                    @endforeach
                    @foreach ($rtt as $row)
                        <tr>
                            <x-pulse::td>RTT, мс · {{ $row->key }}</x-pulse::td>
                            <x-pulse::td numeric>{{ round($row->avg) }}</x-pulse::td>
                            <x-pulse::td numeric>{{ round($row->max) }}</x-pulse::td>
                            <x-pulse::td numeric>{{ $row->count }}</x-pulse::td>
                        </tr>
                    @endforeach
                </tbody>
            </x-pulse::table>
        @endif
    </x-pulse::scroll>
</x-pulse::card>
