// Entry point: reads the options and wires every hook. The work lives in the modules it imports:
// `store` (state), `actions/` (git operations), `helpers/` (pure functions), `ui/` (the pane and its two tabs).
import type { Register } from 'claude-code'

import {
  commandFailed,
  openPane,
  refreshAfterTurn,
  refreshOpenPanes,
  runGraphCommand,
  runPaneCommand,
} from './actions/panes'
import { PANE, REFRESH_INTERVAL } from './constants'
import { toKit } from './helpers/view'
import { refresh } from './store'
import type { Settings } from './types'
import { drawPane } from './ui/pane'

export const register: Register = (on, options) => {
  const settings: Settings = {
    model: typeof options.model === 'string' && options.model ? options.model : 'haiku',
    includeBody: options.includeBody !== false,
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'sc-pane',
      description: 'Open the Source Control pane: switch branch, commit, sync and generate a commit message',
    })
    await $.command.register({
      name: 'sc-pane-graph',
      description: 'Open the Source Control pane on its Graph tab: branch lanes, and actions on a commit',
    })

    const repo = await refresh($).catch(() => null)
    if (repo) void openPane($)

    $.clock.every(REFRESH_INTERVAL, () => {
      void refreshOpenPanes($).catch(() => undefined)
    })

    return next(e)
  })

  on('command.run', { command: 'sc-pane' }, async $ => runPaneCommand($)).catch(commandFailed)
  on('command.run', { command: 'sc-pane-graph' }, async $ => runGraphCommand($)).catch(commandFailed)

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    await refreshAfterTurn($)

    return result
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) =>
    drawPane($, toKit($.ui.resolve(e), e.surface), e.props.bodyColumns, settings),
  )
}
