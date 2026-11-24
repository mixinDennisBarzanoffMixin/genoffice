/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { AiComposer } from '../src/AiComposer'
import { setHostAi } from '../src/host-ai'

it('hands a panel prompt to its host without calling the standalone provider', () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const host = vi.fn()
  const submit = vi.fn()
  const change = vi.fn()
  const node = document.createElement('div')
  const root = createRoot(node)
  setHostAi(host)
  act(() =>
    root.render(
      createElement(AiComposer, {
        value: '  Summarize this sheet  ',
        busy: false,
        placeholder: '',
        hintIdle: '',
        hintBusy: '',
        sendLabel: 'Send',
        stopLabel: 'Stop',
        onChange: change,
        onSend: submit,
        onStop: vi.fn(),
      }),
    ),
  )
  act(() => node.querySelector<HTMLButtonElement>('button[aria-label="Send"]')!.click())
  expect(host).toHaveBeenCalledWith('Summarize this sheet')
  expect(submit).not.toHaveBeenCalled()
  expect(change).toHaveBeenCalledWith('')
  act(() => root.unmount())
  setHostAi(null)
  vi.unstubAllGlobals()
})
