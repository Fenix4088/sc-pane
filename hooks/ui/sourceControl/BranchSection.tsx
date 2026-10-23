// The branch picker and its search, the sync status line and the remote actions (FR-BR-*, FR-REM-1 to 3).
import type { Repo } from '../../../types'
import { ICON, TONE } from '../../constants'
import { branchOptions, pickerOptions, searchOptions } from '../../helpers/branches'
import { dot, svg, syncHint, syncLine } from '../../helpers/view'
import type { Kit, OnPress } from '../../types'

export type BranchActions = {
  pick: (value: string) => void
  search: (text: string) => void
  closeSearch: OnPress
  publish: OnPress
  fetch: OnPress
  sync: OnPress
  pull: OnPress
  push: OnPress
  toggleSyncMenu: OnPress
}

type Props = { kit: Kit; repo: Repo; filter: string | null; isSyncMenuOpen: boolean; actions: BranchActions }

export function BranchSection(props: Props) {
  const { Box } = props.kit

  return (
    <Box flexDirection="column" gap="sm">
      <BranchPicker {...props} />
      <BranchSearch {...props} />
      <SyncStatus kit={props.kit} repo={props.repo} />
      <RemoteActions {...props} />
    </Box>
  )
}

function BranchPicker(props: Props) {
  const { Box, Text, Select, Svg } = props.kit
  const { repo, actions } = props
  const picker = pickerOptions(branchOptions(repo))

  return (
    <Box flexDirection="row" gap="sm" alignItems="center">
      {Svg ? <Svg source={svg(ICON.branch, TONE.muted, 16)} alt="Branch" width={16} height={16} /> : <Text dimColor>⎇</Text>}
      {Select && picker.length > 0 ? (
        <Select
          key="branch"
          options={picker}
          value={repo.branch === 'detached HEAD' ? 'detached' : `local:${repo.branch}`}
          onSelect={actions.pick}
        />
      ) : (
        <Text weight="medium">{repo.branch}</Text>
      )}
    </Box>
  )
}

// Opened by the picker's "More branches…" row: an Input filters every branch, a second Select lists the matches.
function BranchSearch(props: Props) {
  const { Box, Text, Button, Input, Select } = props.kit
  const { filter, actions } = props
  if (filter === null || !Input || !Select) return null

  const found = searchOptions(branchOptions(props.repo), filter)

  return (
    <Box flexDirection="column" gap="sm">
      <Box flexDirection="row" gap="sm" alignItems="center">
        <Input
          key="branch-filter"
          placeholder="Search all branches"
          value={filter}
          submitLabel="search"
          autoFocus
          onInput={actions.search}
          onSubmit={actions.search}
        />
        <Button key="branch-filter-close" label="Cancel" dimColor onPress={actions.closeSearch} />
      </Box>
      {found.length > 0 ? (
        <Select key="branch-search" options={found} value="pick" onSelect={value => (value === 'pick' ? undefined : actions.pick(value))} />
      ) : (
        <Text size="footnote" dimColor>
          No branch matches “{filter}”.
        </Text>
      )}
    </Box>
  )
}

function SyncStatus(props: { kit: Kit; repo: Repo }) {
  const { Box, Text, Svg } = props.kit
  const { repo } = props
  const line = syncLine(repo)

  return (
    <Box flexDirection="row" gap="sm" alignItems="center">
      {Svg ? <Svg source={dot(line.dot)} alt="" width={8} height={8} /> : <Text color={line.color}>●</Text>}
      <Text size="footnote" color={line.color}>
        {line.text}
      </Text>
      {repo.upstream && (
        <Text mono size="footnote" wrap="truncate-end">
          {repo.upstream}
        </Text>
      )}
    </Box>
  )
}

function RemoteActions(props: Props) {
  const { Box, Text, Button } = props.kit
  const { repo, actions } = props

  if (!repo.upstream) {
    return (
      <Box flexDirection="row" gap="sm" flexWrap="wrap">
        <Button key="publish" variant="primary" hotkey="p" onPress={actions.publish}>
          ↑ Publish branch
        </Button>
        <Button key="fetch" hotkey="f" onPress={actions.fetch}>
          Fetch
        </Button>
      </Box>
    )
  }

  if (repo.ahead === 0 && repo.behind === 0) {
    return (
      <Box flexDirection="row" gap="sm" flexWrap="wrap">
        <Button key="fetch" hotkey="f" onPress={actions.fetch}>
          Fetch
        </Button>
        <Button key="pull" hotkey="l" onPress={actions.pull}>
          ↓ Pull <Text dimColor>0</Text>
        </Button>
        <Button key="push" hotkey="p" onPress={actions.push}>
          ↑ Push <Text dimColor>0</Text>
        </Button>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" gap="sm">
      <Box flexDirection="row" gap="sm" flexWrap="wrap">
        <Button key="sync" variant="primary" hotkey="s" onPress={actions.sync}>
          ↻ Sync{' '}
          <Text mono>
            ↓{repo.behind} ↑{repo.ahead}
          </Text>
        </Button>
        <Button key="fetch" hotkey="f" onPress={actions.fetch}>
          Fetch
        </Button>
        <Button key="sync-menu" label="⋯" onPress={actions.toggleSyncMenu} />
      </Box>
      {props.isSyncMenuOpen && (
        <Box flexDirection="row" gap="sm" flexWrap="wrap">
          <Button key="pull" hotkey="l" onPress={actions.pull}>
            ↓ Pull only <Text mono>{repo.behind}</Text>
          </Button>
          <Button key="push" hotkey="p" onPress={actions.push}>
            ↑ Push only <Text mono>{repo.ahead}</Text>
          </Button>
        </Box>
      )}
      <Text size="footnote" dimColor>
        {syncHint(repo)}
      </Text>
    </Box>
  )
}
