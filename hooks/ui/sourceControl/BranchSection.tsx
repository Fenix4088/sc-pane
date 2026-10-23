// The branch row: the branch picker on the left, the sync state on the right, and the branch search under
// them while it is open (FR-BR-*, FR-REM-1 to 3).
import type { Repo } from '../../../types'
import { ICON, TONE } from '../../constants'
import { branchOptions, pickerOptions, searchOptions } from '../../helpers/branches'
import type { Kit, OnPress } from '../../types'
import { Icon } from '../common'

export type BranchActions = {
  pick: (value: string) => void
  search: (text: string) => void
  closeSearch: OnPress
  publish: OnPress
  fetch: OnPress
  sync: OnPress
}

type Props = { kit: Kit; repo: Repo; filter: string | null; actions: BranchActions }

export function BranchSection(props: Props) {
  const { Box } = props.kit

  return (
    <Box flexDirection="column" gap="sm">
      <Box flexDirection="row" gap="sm" alignItems="center" justifyContent="space-between">
        <BranchPicker {...props} />
        <SyncState {...props} />
      </Box>
      <BranchSearch {...props} />
    </Box>
  )
}

function BranchPicker(props: Props) {
  const { Box, Text, Select } = props.kit
  const { repo, actions } = props
  const picker = pickerOptions(branchOptions(repo))

  return (
    <Box flexDirection="row" gap="sm" alignItems="center" flexShrink={1}>
      {props.kit.Svg ? <Icon kit={props.kit} paths={ICON.branch} alt="Branch" size={15} /> : <Text dimColor>⎇</Text>}
      {Select && picker.length > 0 ? (
        <Select
          key="branch"
          options={picker}
          value={repo.branch === 'detached HEAD' ? 'detached' : `local:${repo.branch}`}
          onSelect={actions.pick}
        />
      ) : (
        <Text weight="semibold">{repo.branch}</Text>
      )}
    </Box>
  )
}

// Up to date with a fetch button, Sync with its counts, or Publish for a branch with no upstream.
function SyncState(props: Props) {
  const { Box, Text, Button } = props.kit
  const { repo, actions } = props

  if (!repo.upstream) {
    return (
      <Box flexDirection="row" gap="sm" alignItems="center" flexShrink={0}>
        <Text size="footnote" dimColor>
          Not published
        </Text>
        <Button key="publish" hotkey="p" onPress={actions.publish}>
          ↑ Publish
        </Button>
      </Box>
    )
  }

  if (repo.ahead === 0 && repo.behind === 0) {
    return (
      <Box flexDirection="row" gap="sm" alignItems="center" flexShrink={0}>
        {props.kit.Svg ? (
          <Icon kit={props.kit} paths={ICON.check} alt="In sync" tone={TONE.green} />
        ) : (
          <Text color="success">✓</Text>
        )}
        <Text size="footnote" dimColor>
          Up to date
        </Text>
        <Button key="fetch" label="⤓" plain dimColor hotkey="f" onPress={actions.fetch} />
      </Box>
    )
  }

  return (
    <Button key="sync" hotkey="s" onPress={actions.sync}>
      ↻ Sync{' '}
      <Text dimColor tabular>
        ↓{repo.behind} ↑{repo.ahead}
      </Text>
    </Button>
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
