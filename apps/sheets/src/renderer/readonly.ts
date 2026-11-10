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

/** The connected toolbar dispatches only existing session-local view actions. */
export function viewing(command: string): boolean {
  if (['find', 'zoom-in', 'zoom-out', 'zoom-reset', 'zoom-to-selection'].includes(command)) return true
  if (!/^zoom:\d{2,3}$/.test(command)) return false
  const percent = Number(command.slice(5))
  return percent >= 50 && percent <= 400
}

/** Navigation operations plus the existing facade commands for zoom and Go To. */
export function navigation(id: string, operation: boolean): boolean {
  if (id === 'ui.operation.open-replace-dialog') return false
  return operation || ['sheet.command.set-zoom-ratio', 'sheet.command.scroll-to-cell'].includes(id)
}
