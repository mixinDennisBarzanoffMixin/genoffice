import { z } from 'zod'

export const formulaCacheSchema = z.object({
        kind: z.enum(['refreshed', 'not_refreshed']),
        reason: z.enum(['complete', 'structure', 'inventory', 'limit', 'unsupported']),
        count: z.number().int().nonnegative(),
      }).strict()
