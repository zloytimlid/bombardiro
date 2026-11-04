import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { aircraftConfigSchema } from './config';

/**
 * JSON Schema в resources/sim/schemas генерируется из zod (одна схема — раздел 1, правило 5).
 * Обновить после правки config.ts: npm run schemas:generate
 */
describe('generated JSON schemas', () => {
    it('aircraft.schema.json matches the zod schema', async () => {
        const schema = {
            $id: 'https://lil-critter.test/schemas/aircraft.schema.json',
            title: 'B-25J aircraft config',
            ...z.toJSONSchema(aircraftConfigSchema),
        };

        await expect(JSON.stringify(schema, null, 4) + '\n').toMatchFileSnapshot('../../../sim/schemas/aircraft.schema.json');
    });
});
