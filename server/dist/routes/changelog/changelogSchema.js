// WARNING! - Any changes here MUST be the same between app/src/api & server/src/routes/changelog
import { z } from 'zod';
export const ChangelogEntrySchema = z.object({
    version: z.string(),
    date: z.string(),
    body: z.string(),
});
export const ChangelogResponseSchema = z.object({
    entries: z.array(ChangelogEntrySchema),
});
//# sourceMappingURL=changelogSchema.js.map