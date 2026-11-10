/** Fixed per-frame mode; disable execution without selecting an RPC worker. */
export function configuration(name: string, options: unknown, readonly: boolean): unknown {
  if (!readonly || !['UNIVER_ENGINE_FORMULA_PLUGIN', 'SHEET_PLUGIN', 'SHEETS_FORMULA_PLUGIN'].includes(name)) return options
  return {
    ...(typeof options === 'object' && options !== null ? options : {}),
    // On the Sheets plugins this flag selects remote execution and requires RPC.
    // Only the engine flag removes the interpreter and calculation service.
    notExecuteFormula: name === 'UNIVER_ENGINE_FORMULA_PLUGIN',
    // Pinned 0.25.1 CalculationMode.NO_CALCULATION; checked against the real enum.
    initialFormulaComputing: 2,
  }
}
