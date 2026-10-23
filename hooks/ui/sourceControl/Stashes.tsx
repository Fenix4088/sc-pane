// STASHES with Apply, Pop and Drop per row; Drop asks first, in the pane's question card (FR-STA-3).
import type { Stash } from '../../../types'
import { LIST_LIMIT } from '../../constants'
import type { Kit, OnPress } from '../../types'
import { HoverActions } from '../common'
import { SectionHeader } from './SectionHeader'

export type StashActions = {
  toggle: OnPress
  apply: (stash: Stash) => OnPress
  pop: (stash: Stash) => OnPress
  askDrop: (stash: Stash) => OnPress
}

type Props = { kit: Kit; stashes: Stash[]; isOpen: boolean; actions: StashActions }

export function Stashes(props: Props) {
  const { Box } = props.kit
  const { stashes } = props
  if (stashes.length === 0) return null

  return (
    <Box flexDirection="column">
      <SectionHeader
        kit={props.kit}
        id="stashes"
        title="Stashes"
        count={stashes.length}
        isOpen={props.isOpen}
        onToggle={props.actions.toggle}
      />
      {props.isOpen && stashes.slice(0, LIST_LIMIT).map(one => <StashRow {...props} stash={one} />)}
    </Box>
  )
}

function StashRow(props: Props & { stash: Stash }) {
  const { Box, Text, Button } = props.kit
  const { stash: one, actions } = props

  return (
    <Box key={`stash:${one.index}`} flexDirection="row" gap="sm" alignItems="center" paddingLeft={2}>
      <Text mono size="footnote" dimColor>
        {one.ref}
      </Text>
      <Box flexGrow={1} flexShrink={1}>
        <Text wrap="truncate-end">{one.message}</Text>
      </Box>
      <HoverActions kit={props.kit}>
        <Button key={`stash-apply:${one.index}`} label="Apply" plain dimColor onPress={actions.apply(one)} />
        <Button key={`stash-pop:${one.index}`} label="Pop" plain dimColor onPress={actions.pop(one)} />
        <Button key={`stash-drop:${one.index}`} label="Drop" plain dimColor onPress={actions.askDrop(one)} />
      </HoverActions>
      <Text size="footnote" dimColor wrap="truncate-end">
        {one.branch ? `on ${one.branch} · ${one.when}` : one.when}
      </Text>
    </Box>
  )
}
