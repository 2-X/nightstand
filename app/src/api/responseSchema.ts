import { z } from 'zod';

// Clone containers so response compatibility never weakens request validation.
// Reusing each definition preserves array limits and other existing constraints.
export function responseSchema<T extends z.ZodTypeAny>(schema: T): T {
  const definition = schema._def;
  switch (definition.typeName) {
  case z.ZodFirstPartyTypeKind.ZodObject:
    return new (schema.constructor as typeof z.ZodObject)({ ...definition, unknownKeys: 'strip', shape: () => Object.fromEntries(
      Object.entries((schema as unknown as z.AnyZodObject).shape)
        .map(([key, value]) => [key, responseSchema(value as z.ZodTypeAny)]),
    ) }) as unknown as T;
  case z.ZodFirstPartyTypeKind.ZodArray:
    return new (schema.constructor as typeof z.ZodArray)({ ...definition, type: responseSchema(definition.type) }) as unknown as T;
  case z.ZodFirstPartyTypeKind.ZodRecord:
    return new (schema.constructor as typeof z.ZodRecord)({ ...definition, valueType: responseSchema(definition.valueType) }) as unknown as T;
  case z.ZodFirstPartyTypeKind.ZodUnion:
    return new (schema.constructor as typeof z.ZodUnion)({ ...definition, options: definition.options.map(responseSchema) }) as unknown as T;
  case z.ZodFirstPartyTypeKind.ZodDiscriminatedUnion:
    return new (schema.constructor as typeof z.ZodDiscriminatedUnion)({ ...definition,
      options: definition.options.map(responseSchema),
      optionsMap: new Map([...definition.optionsMap].map(([key, value]) => [key, responseSchema(value)])),
    }) as unknown as T;
  case z.ZodFirstPartyTypeKind.ZodOptional:
    return new (schema.constructor as typeof z.ZodOptional)({
      ...definition, innerType: responseSchema(definition.innerType),
    }) as unknown as T;
  case z.ZodFirstPartyTypeKind.ZodNullable:
    return new (schema.constructor as typeof z.ZodNullable)({
      ...definition, innerType: responseSchema(definition.innerType),
    }) as unknown as T;
  case z.ZodFirstPartyTypeKind.ZodDefault:
    return new (schema.constructor as typeof z.ZodDefault)({
      ...definition, innerType: responseSchema(definition.innerType),
    }) as unknown as T;
  default:
    return schema;
  }
}
