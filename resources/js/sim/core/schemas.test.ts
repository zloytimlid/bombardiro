import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { aircraftConfigSchema } from './config';
import { missionSchema } from './mission/schema';

/**
 * JSON Schema в resources/sim/schemas генерируется из zod (одна схема — раздел 1, правило 5).
 * Сервер валидирует миссии по mission.schema.json. Обновить после правки схем: npm run schemas:generate
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

    it('mission.schema.json matches the zod schema', async () => {
        const schema = {
            $id: 'https://lil-critter.test/schemas/mission.schema.json',
            title: 'Mission definition (section 8.3)',
            ...z.toJSONSchema(missionSchema, { io: 'input' }),
        };

        await expect(JSON.stringify(schema, null, 4) + '\n').toMatchFileSnapshot('../../../sim/schemas/mission.schema.json');
    });
});
