export type CursorPaginatedDataCollection<TKey, TValue> = CursorPaginator<TKey, TValue>;
export type CursorPaginator<TKey, TValue> = {
data: TKey extends string ? Record<TKey, TValue> : TValue[],
links: {
url: string | null,
label: string,
active: boolean,
}[],
meta: {
path: string,
per_page: number,
next_cursor: string | null,
next_page_url: string | null,
prev_cursor: string | null,
prev_page_url: string | null,
},
};
export type CursorPaginatorInterface<TKey, TValue> = CursorPaginator<TKey, TValue>;
export type LengthAwarePaginator<TKey, TValue> = {
data: TKey extends string ? Record<TKey, TValue> : TValue[],
links: {
url: string | null,
label: string,
active: boolean,
}[],
meta: {
total: number,
current_page: number,
first_page_url: string,
from: number | null,
last_page: number,
last_page_url: string,
next_page_url: string | null,
path: string,
per_page: number,
prev_page_url: string | null,
to: number | null,
},
};
export type LengthAwarePaginatorInterface<TKey, TValue> = LengthAwarePaginator<TKey, TValue>;
export type NetBootstrapData = {
v: number,
session: string,
crew: string,
status: string,
seed: number,
difficulty: string,
host_user_id: number | null,
user_id: number,
seat: string | null,
roster: NetSeatData[],
mission: Record<string, any>,
aircraft_config: Record<string, any>,
theatre: Record<string, any>,
theatre_name: string,
theatre_placeholder: boolean,
max_time_scale: number,
airframe_zones: Record<string, number>,
flight: {
ulid: string,
slot: number,
slots: {
slot: number,
crew: string,
name: string,
session: string | null,
}[],
} | null,
};
export type NetEventBatchData = {
v: number,
events: NetEventData[],
};
export type NetEventData = {
seq: number,
tick: number,
type: string,
payload: Record<string, any> | null,
};
export type NetFinishData = {
v: number,
outcome: string,
last_seq: number,
damage_share: number,
duration_s: number,
crew: {
station: string,
health: string,
bailedOut: boolean,
}[],
stations: Record<string, {
key: string,
value: number | null,
unit: string,
}[]>,
track: {
t: number,
x: number,
y: number,
z: number,
}[],
zones: Record<string, number>,
};
export type NetHeartbeatData = {
rtt_ms: number | null,
};
export type NetSeatData = {
seat: string,
user_id: number | null,
callsign: string | null,
is_ai: boolean,
};
export type NetSnapshotData = {
v: number,
tick: number,
state: Record<string, any> | null,
};
export type PaginatedDataCollection<TKey, TValue> = LengthAwarePaginator<TKey, TValue>;
export type UserSettingsData = {
bindings: Record<string, string[]> | null,
mouse_sensitivity: number,
invert_y: boolean,
gamepad_axes: Record<string, {
index: number,
invert: boolean,
}> | null,
gamepad_deadzone: number,
gamepad_curve: number,
graphics: string,
render_scale: number,
shadows: boolean,
volumes: Record<string, number> | null,
subtitles: boolean,
camera_shake: boolean,
ui_scale: number,
long_actions: string,
units: string,
renderer: string,
};
