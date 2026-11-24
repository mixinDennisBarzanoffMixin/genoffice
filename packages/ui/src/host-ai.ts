/**
 * AI hand-off for an embedding host. When the editors run inside another app
 * that has its own assistant, the host registers a callback here before the
 * app renders; every AI action then hands its prompt to the host instead of
 * opening the built-in AI panel. Each editor runs in its own iframe, so one
 * module-level slot is enough. Null (the default) means the standalone app.
 */
import { useEffect, useRef } from 'react'

/** Set by an embedding host before the app renders; null in the standalone desktop app. */
export type HostContext =
  | { kind: 'cell'; sheet: string; range: string }
  | { kind: 'word'; page: number; selection: { from: number; to: number } }
  | { kind: 'slide'; slide: number; selection: string[] }
export type HostAi = (prompt: string, context: HostContext) => void

let current: HostAi | null = null

export function setHostAi(fn: HostAi | null): void {
  current = fn
}

export function hostAi(): HostAi | null {
  return current
}

/**
 * An editor's own AI tools, offered to the host's assistant so it can read and
 * edit the live document the way the built-in panel did.
 */
export type HostTool = { name: string; description: string; inputSchema: unknown }
export type HostToolResult = { output: string; isError?: boolean; mutated: boolean }
export type HostAgent = {
  /** How to drive the tools: the editor's agent instructions. */
  guide(): string
  tools(): HostTool[]
  run(name: string, input: Record<string, unknown>): Promise<HostToolResult>
}

let agent: HostAgent | null = null
let waiting: ((value: HostAgent) => void)[] = []

/** Registered by an editor once it can run its tools; null when it goes away. */
export function setHostAgent(value: HostAgent | null): void {
  agent = value
  if (!value) return
  const pending = waiting
  waiting = []
  pending.forEach((resolve) => resolve(value))
}

/** The editor's agent, waiting for it to register — the tools need a rendered editor. */
export function whenHostAgent(): Promise<HostAgent> {
  if (agent) return Promise.resolve(agent)
  return new Promise((resolve) => waiting.push(resolve))
}

/** The shape `createDocsSkill`/`createWorkbookSkill`/`createSlidesSkill` (packages/agent-core's AgentSkill) already have. */
export interface HostSkill {
  systemPrompt: string
  tools: readonly { name: string; description: string; inputSchema: unknown }[]
  executeTool(call: {
    id: string
    name: string
    input: Record<string, unknown>
  }): { output: string; isError?: boolean; mutated?: boolean } | Promise<{ output: string; isError?: boolean; mutated?: boolean }>
}

/**
 * Registers `skill` as the host agent for as long as the caller stays
 * mounted, dropping any tool named in `exclude` — tools that reach this
 * editor's own model or cloud services (search, image generation, whole-
 * document generation); the host runs its own assistant instead. A no-op
 * when there is no embedding host (`hostAi()` is null).
 *
 * `skill` may be rebuilt every render (as `sheetsSkillDeps()`-style deps
 * often are): only its first value's identity matters for (de)registration,
 * later values are read through a ref so the registration itself does not
 * flicker.
 */
export function useHostAgent(skill: HostSkill, exclude: ReadonlySet<string> = new Set()): void {
  const ref = useRef(skill)
  ref.current = skill
  useEffect(() => {
    if (!hostAi()) return
    let calls = 0
    setHostAgent({
      guide: () => ref.current.systemPrompt,
      tools: () =>
        ref.current.tools
          .filter((tool) => !exclude.has(tool.name))
          .map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema })),
      run: async (name, input) => {
        if (exclude.has(name) || !ref.current.tools.some((tool) => tool.name === name))
          return { output: `Unknown tool: ${name}`, isError: true, mutated: false }
        const result = await ref.current.executeTool({ id: `host-${++calls}`, name, input })
        return { output: result.output, isError: result.isError === true, mutated: result.mutated === true }
      },
    })
    return () => setHostAgent(null)
    // Registers once; skill and exclude are read fresh through ref.current above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
