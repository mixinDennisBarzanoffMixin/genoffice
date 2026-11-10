/** Fixed per-frame mode. Configure every formula-capable plugin before creation. */
export function configuration(name: string, options: unknown, readonly: boolean): unknown {
  if (!readonly || !['UNIVER_ENGINE_FORMULA_PLUGIN', 'SHEET_PLUGIN', 'SHEETS_FORMULA_PLUGIN'].includes(name)) return options
  return {
    ...(typeof options === 'object' && options !== null ? options : {}),
    notExecuteFormula: true,
    initialFormulaComputing: false,
  }
}
