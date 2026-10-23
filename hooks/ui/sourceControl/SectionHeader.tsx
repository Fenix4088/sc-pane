import type { Kit, OnPress } from '../../types'
import { CountPill, HoverActions } from '../common'

// A collapsible section's title row: ▾/▸ and the title, its count in a pill, and the section's actions on the
// right, revealed on hover where the pointer is reported.
export function SectionHeader(props: {
  kit: Kit
  id: string
  title: string
  count: number
  isOpen: boolean
  onToggle: OnPress
  actions?: JSX.Element | null
}) {
  const { Box, Button } = props.kit

  return (
    <Box key={`section:${props.id}`} flexDirection="row" justifyContent="space-between" alignItems="center">
      <Box flexDirection="row" gap="sm" alignItems="center">
        <Button
          key={`toggle:${props.id}`}
          label={`${props.isOpen ? '▾' : '▸'} ${props.title.toUpperCase()}`}
          plain
          dimColor
          onPress={props.onToggle}
        />
        <CountPill kit={props.kit} count={props.count} />
      </Box>
      {props.actions ? <HoverActions kit={props.kit}>{props.actions}</HoverActions> : null}
    </Box>
  )
}
