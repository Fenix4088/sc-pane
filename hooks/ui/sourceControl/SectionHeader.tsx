import type { Kit, OnPress } from '../../types'

// A collapsible section's title row: ▾/▸, the title, its count, and the section's actions on the right.
export function SectionHeader(props: {
  kit: Kit
  id: string
  title: string
  count: number
  isOpen: boolean
  onToggle: OnPress
  actions?: JSX.Element | null
}) {
  const { Box, Text, Button } = props.kit

  return (
    <Box flexDirection="row" justifyContent="space-between" alignItems="center">
      <Button key={`toggle:${props.id}`} plain dimColor onPress={props.onToggle}>
        {props.isOpen ? '▾' : '▸'} {props.title.toUpperCase()} <Text mono>{props.count}</Text>
      </Button>
      {props.actions ?? <Text> </Text>}
    </Box>
  )
}
