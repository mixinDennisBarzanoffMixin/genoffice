import { input } from '../shared/recalc-input'
export { input } from '../shared/recalc-input'
import { z } from 'zod'
import { workbookFormulaCellsResultSchema, type WorkbookSaveRequest } from '../shared/desktop-api'
import type { XlsxSidecarClient } from './xlsx-sidecar-client'

const value = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('number'), value: z.number().finite() }).strict(),
  z.object({ kind: z.literal('string'), value: z.string() }).strict(),
  z.object({ kind: z.literal('boolean'), value: z.boolean() }).strict(),
  z.object({ kind: z.literal('error'), value: z.enum(['#NULL!', '#DIV/0!', '#VALUE!', '#REF!', '#NAME?', '#NUM!', '#N/A']) }).strict(),
])
export const recalculated = z.object({
  cells: z.array(z.object({
    sheet: z.string(), row: z.number().int().nonnegative(), column: z.number().int().nonnegative(),
    formatted: z.string(), number: z.number().finite().optional(), isError: z.boolean(), isFormula: z.boolean(),
    value: value.nullable(), reason: z.enum(['engine_gap', 'external_pinned', 'unavailable']).nullable(),
  }).strict()).max(20_000),
  cached: z.boolean(),
}).strict()

type Cache = { sheetName: string; cells: { row: number; column: number; value: string | number | boolean | { error: string } }[] }
type Status = { kind: 'refreshed' | 'not_refreshed'; reason: 'complete' | 'structure' | 'inventory' | 'limit' | 'unsupported'; count: number }
const key = (sheet: string, row: number, column: number) => JSON.stringify([sheet, row, column])

/** A complete, bounded snapshot inventory; never renderer viewport/overlay values. */
export async function refresh(
  access: ReturnType<XlsxSidecarClient['forSave']>,
  session: { snapshotPath: string; sheetNames: ReadonlyMap<string, string> },
  request: WorkbookSaveRequest,
): Promise<{ values: Cache[]; status: Status }> {
  const partial = (reason: Status['reason']) => ({ values: [], status: { kind: 'not_refreshed' as const, reason, count: 0 } })
  if (request.sheetOps.length || request.structuralOps.length) return partial('structure')
  const formulas = new Map<string, { sheet: string; row: number; column: number; formula: string }>()
  const deadline = performance.now() + 1000
  for (const [id, sheet] of session.sheetNames) {
    if (performance.now() >= deadline) return partial('inventory')
    let result = workbookFormulaCellsResultSchema.parse(await access.formulas({ sessionId: request.sessionId, sheetId: id }))
    while (!result.indexingComplete && performance.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 20))
      result = workbookFormulaCellsResultSchema.parse(await access.formulas({ sessionId: request.sessionId, sheetId: id }))
    }
    if (performance.now() >= deadline || !result.indexingComplete || result.truncated) return partial('inventory')
    // Shared, array and data-table formulas need coverage beyond ordinary formula coordinates.
    if (result.unsupported) return partial('unsupported')
    for (const cell of result.cells) {
      if (cell.formula === undefined) throw new Error('Formula inventory omitted formula')
      formulas.set(key(sheet, cell.row, cell.column), { sheet, row: cell.row, column: cell.column, formula: cell.formula })
    }
  }
  const edits: { sheet: string; row: number; column: number; input: string }[] = []
  const name = (id: string) => {
    const sheet = session.sheetNames.get(id)
    if (sheet === undefined) throw new Error('Unknown formula worksheet')
    return sheet
  }
  const edit = (sheet: string, row: number, column: number, value: string | number | boolean | null, formula?: string) => {
    edits.push({ sheet, row, column, input: input(value, formula) })
    if (formula !== undefined && formula !== '') formulas.set(key(sheet, row, column), { sheet, row, column, formula })
    else formulas.delete(key(sheet, row, column))
  }
  for (const cell of request.edits) {
    if (cell.writeValue) edit(name(cell.sheetId), cell.row, cell.column, cell.value, cell.formula)
  }
  if (edits.length > 10_000) return partial('limit')
  if (request.bulkConstantFills !== undefined) for (const fill of request.bulkConstantFills) {
    const size = (fill.endRow - fill.startRow + 1) * (fill.endColumn - fill.startColumn + 1)
    if (edits.length + size > 10_000) return partial('limit')
    for (let row = fill.startRow; row <= fill.endRow; row++) for (let column = fill.startColumn; column <= fill.endColumn; column++) {
      edit(name(fill.sheetId), row, column, fill.value)
    }
  }
  // The existing canonical command permits 128 read rectangles; no cap expansion.
  if (formulas.size > 128) return partial('limit')
  if (!formulas.size) return { values: [], status: { kind: 'refreshed', reason: 'complete', count: 0 } }
  const result = recalculated.parse(await access.recalc({
    path: session.snapshotPath, edits,
    reads: [...formulas.values()].map(cell => ({ sheet: cell.sheet, range: { startRow: cell.row, endRow: cell.row, startColumn: cell.column, endColumn: cell.column } })),
  }))
  const seen = new Set<string>()
  const values = new Map<string, Cache['cells']>()
  let count = 0
  for (const cell of result.cells) {
    const id = key(cell.sheet, cell.row, cell.column)
    const formula = formulas.get(id)
    if (!formula || seen.has(id)) throw new Error('Formula result coordinates mismatch')
    seen.add(id)
    const locale = formula.formula.split('"').some((text, index) => index % 2 === 0 && /(?:^|[^A-Z0-9_.])(?:NUMBERSTRING|DOLLAR)\s*\(/.test(text.toUpperCase()))
    if (!cell.isFormula || cell.value === null || cell.reason !== null || (cell.isError && (cell.formatted === '#NAME?' || cell.formatted === '#ERROR!')) || locale) { count++; continue }
    let list = values.get(cell.sheet)
    if (!list) { list = []; values.set(cell.sheet, list) }
    list.push({ row: cell.row, column: cell.column, value: cell.value.kind === 'error' ? { error: cell.value.value } : cell.value.value })
  }
  if (seen.size !== formulas.size) throw new Error('Formula result coordinates missing')
  return {
    values: [...values].map(([sheetName, cells]) => ({ sheetName, cells })),
    status: { kind: count ? 'not_refreshed' : 'refreshed', reason: count ? 'unsupported' : 'complete', count },
  }
}
