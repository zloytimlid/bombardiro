/**
 * Рисунок заказчика для слота nose_art (раздел 3, «Ливрея и права»): первая картинка из
 * resources/images/nose-art/. Нет файла — слот пустой (Li'l Abner не воспроизводится).
 */
const files = import.meta.glob<string>('../../../images/nose-art/*.{png,webp}', { eager: true, query: '?url', import: 'default' });

export const NOSE_ART_URL: string | null = Object.keys(files).sort().map((k) => files[k]!)[0] ?? null;
