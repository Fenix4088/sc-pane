import type { Kit, OnPress } from '../../types'

export type HeaderActions = { refresh: OnPress; graph: OnPress; more: OnPress }

// Title, ↻ refresh, Graph and ⋯ (FR-PANE-4); Graph and ⋯ only inside a repository.
export function Header(props: { kit: Kit; isRepo: boolean; actions: HeaderActions }) {
  const { Box, Text, Button } = props.kit
  const { actions } = props

  return (
    <Box flexDirection="row" justifyContent="space-between" alignItems="center">
      <Text weight="semibold" bold>
        Source Control
      </Text>
      <Box flexDirection="row" gap="sm" alignItems="center">
        <Button key="refresh" label="↻" plain dimColor hotkey="r" onPress={actions.refresh} />
        {props.isRepo && <Button key="graph" label="Graph" plain dimColor onPress={actions.graph} />}
        {props.isRepo && <Button key="more" label="⋯" plain dimColor hotkey="m" onPress={actions.more} />}
      </Box>
    </Box>
  )
}
