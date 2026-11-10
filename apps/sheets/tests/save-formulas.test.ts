import { test, expect } from 'vitest'
import { refresh, input, recalculated } from '../src/main/save-formulas'
import { workbookSaveRequestSchema } from '../src/shared/desktop-api'
const session = { snapshotPath: '/s/workbook.xlsx', sheetNames: new Map([['sheet', 'Data']]) }
function request() {
  return workbookSaveRequestSchema.parse({
    sessionId: '5d4f6f7a-1c2b-4e3d-9a8f-0b1c2d3e4f5a', mode: 'save',
    edits: [{ sheetId: 'sheet', row: 0, column: 0, writeValue: true, value: 8 }],
    structuralOps: [], chartEdits: [], visualEdits: [], visualAdditions: [], tableAdditions: [], pivotAdditions: [],
    sheetOps: [], sheetOrder: [], filterStates: [], hyperlinkEdits: [], cfStates: [], dvStates: [], pageSetupStates: [],
    noteStates: [], formulaValues: [{ sheetId: 'sheet', row: 0, column: 1, value: 3 }], pivotCacheRefreshPaths: [],
    pivotRefreshUpdates: [], sheetProtections: [], sparklineAdditions: [], definedNamesState: null,
  })
}
const cell = { sheet: 'Data', row: 0, column: 1, formatted: '10', number: 10, isError: false, isFormula: true, value: { kind: 'number' as const, value: 10 }, reason: null }
const inventory = { cells: [{ row: 0, column: 1, formula: '=A1+2', value: 3 }], indexingComplete: true, truncated: false, unsupported: false }
test('native results replace stale renderer caches; input text is never numeric coercion', async () => {
  expect(input('001')).toBe("'001")
  expect(input('=1')).toBe("'=1")
  expect(input(null, '=A1+2')).toBe('=A1+2')
  const result = await refresh({ formulas: async () => inventory, recalc: async args => {
    expect(args.edits).toEqual([{ sheet: 'Data', row: 0, column: 0, input: '8' }])
    expect(args.reads).toHaveLength(1)
    return { cells: [cell], cached: false }
  } }, session, request())
  expect(result.values[0]?.cells[0]?.value).toBe(10)
  expect(result.status.kind).toBe('refreshed')
})
test('formula replacement is inventoried and formula-to-constant is removed', async () => {
  const cfg = request()
  cfg.edits.push({ sheetId: 'sheet', row: 0, column: 1, writeValue: true, value: 4 })
  cfg.edits.push({ sheetId: 'sheet', row: 99, column: 2, writeValue: true, value: null, formula: '=A1+2' })
  await refresh({ formulas: async () => inventory, recalc: async args => {
    expect(args.reads).toEqual([{ sheet: 'Data', range: { startRow: 99, endRow: 99, startColumn: 2, endColumn: 2 } }])
    return { cells: [{ ...cell, row: 99, column: 2 }], cached: false }
  } }, session, cfg)
})
for (const cells of [[], [cell, cell], [{ ...cell, column: 2 }]]) test('missing, duplicate or extra native coordinates abort', async () => {
  await expect(refresh({ formulas: async () => inventory, recalc: async () => ({ cells, cached: false }) }, session, request())).rejects.toThrow('coordinates')
})
for (const flag of ['truncated', 'unsupported'] as const) test(`${flag} inventory is explicitly partial without native work`, async () => {
  const result = await refresh({ formulas: async () => ({ ...inventory, [flag]: true }), recalc: async () => { throw new Error('must not run') } }, session, request())
  expect(result.status.kind).toBe('not_refreshed')
  expect(result.values).toEqual([])
})
test('native timeout aborts without a remembered bypass on the next user save', async () => {
  let calls = 0
  const access = { formulas: async () => inventory, recalc: async () => { calls++; throw new Error('timeout') } }
  await expect(refresh(access, session, request())).rejects.toThrow('timeout')
  await expect(refresh(access, session, request())).rejects.toThrow('timeout')
  expect(calls).toBe(2)
})
test('tagged values reject nonfinite numbers, extra keys and invented error codes', () => {
  for (const value of [{ kind: 'number', value: NaN }, { kind: 'error', value: '#ERROR!' }, { kind: 'string', value: '', extra: true }]) {
    expect(() => recalculated.parse({ cells: [{ ...cell, value }], cached: false })).toThrow()
  }
})
test('unsupported results preserve caches and report qualification', async () => {
  const result = await refresh({ formulas: async () => inventory, recalc: async () => ({ cells: [{ ...cell, value: null, reason: 'engine_gap' }], cached: false }) }, session, request())
  expect(result.values).toEqual([])
  expect(result.status).toEqual({ kind: 'not_refreshed', reason: 'unsupported', count: 1 })
})
