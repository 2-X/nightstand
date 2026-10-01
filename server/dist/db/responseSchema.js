// WARNING! - Any changes here MUST be the same between app/src/api & server/src/db/
import { z } from 'zod';
// Rebuild objects to strip unknown keys, so readers of responses and stored
// files tolerate newer data. Request validation keeps the strict originals.
// Reusing each definition preserves array limits and other existing constraints.
export function responseSchema(schema) {
    const definition = schema._def;
    switch (definition.typeName) {
        case z.ZodFirstPartyTypeKind.ZodObject:
            return new schema.constructor({ ...definition, unknownKeys: 'strip', shape: () => Object.fromEntries(Object.entries(schema.shape)
                    .map(([key, value]) => [key, responseSchema(value)])) });
        case z.ZodFirstPartyTypeKind.ZodArray:
            return new schema.constructor({ ...definition, type: responseSchema(definition.type) });
        case z.ZodFirstPartyTypeKind.ZodRecord:
            return new schema.constructor({ ...definition, valueType: responseSchema(definition.valueType) });
        case z.ZodFirstPartyTypeKind.ZodUnion:
            return new schema.constructor({ ...definition, options: definition.options.map(responseSchema) });
        case z.ZodFirstPartyTypeKind.ZodDiscriminatedUnion:
            return new schema.constructor({ ...definition,
                options: definition.options.map(responseSchema),
                optionsMap: new Map([...definition.optionsMap].map(([key, value]) => [key, responseSchema(value)])),
            });
        case z.ZodFirstPartyTypeKind.ZodEffects: {
            const effects = definition;
            return new schema.constructor({ ...effects, schema: responseSchema(effects.schema) });
        }
        case z.ZodFirstPartyTypeKind.ZodLazy: {
            const lazy = definition;
            return new schema.constructor({ ...lazy, getter: () => responseSchema(lazy.getter()) });
        }
        case z.ZodFirstPartyTypeKind.ZodIntersection: {
            const intersection = definition;
            return new schema.constructor({
                ...intersection, left: responseSchema(intersection.left), right: responseSchema(intersection.right),
            });
        }
        case z.ZodFirstPartyTypeKind.ZodPipeline: {
            const pipeline = definition;
            return new schema.constructor({
                ...pipeline, in: responseSchema(pipeline.in), out: responseSchema(pipeline.out),
            });
        }
        case z.ZodFirstPartyTypeKind.ZodReadonly: {
            const readonly = definition;
            return new schema.constructor({ ...readonly, innerType: responseSchema(readonly.innerType) });
        }
        case z.ZodFirstPartyTypeKind.ZodOptional:
            return new schema.constructor({
                ...definition, innerType: responseSchema(definition.innerType),
            });
        case z.ZodFirstPartyTypeKind.ZodNullable:
            return new schema.constructor({
                ...definition, innerType: responseSchema(definition.innerType),
            });
        case z.ZodFirstPartyTypeKind.ZodDefault:
            return new schema.constructor({
                ...definition, innerType: responseSchema(definition.innerType),
            });
        default:
            return schema;
    }
}
//# sourceMappingURL=responseSchema.js.map