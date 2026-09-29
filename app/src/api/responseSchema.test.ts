import { expect, it } from 'vitest';
import { z } from 'zod';
import { responseSchema } from './responseSchema';

it('recurses through containers while preserving array bounds and required values', () => {
  const object = z.object({ value: z.number().min(1) }).strict();
  const schema = z.object({
    list: object.array().max(2),
    choice: z.union([object, z.string()]),
    tagged: z.discriminatedUnion('kind', [object.extend({ kind: z.literal('one') }), object.extend({ kind: z.literal('two') })]),
    record: z.record(object),
    maybe: object.optional().nullable(),
  }).strict();
  const nested = { value: 1, future: true };
  const input = { list: [nested], choice: nested, tagged: { ...nested, kind: 'one' }, record: { entry: nested }, maybe: nested, future: true };
  const parsed = responseSchema(schema).parse(input);
  expect(JSON.stringify(parsed)).not.toContain('future');
  expect(schema.safeParse(input).success).toBe(false);
  expect(responseSchema(schema).safeParse({ ...input, list: [nested, nested, nested] }).success).toBe(false);
  expect(responseSchema(schema).safeParse({ ...input, maybe: null }).success).toBe(true);
  expect(responseSchema(schema).safeParse({ ...input, choice: { value: 0 } }).success).toBe(false);
});
