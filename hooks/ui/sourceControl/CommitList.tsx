// INCOMING and OUTGOING commits while the branch is ahead or behind (FR-CHG-6).
import type { Commit } from '../../../types'
import type { Kit, OnPress } from '../../types'
import { SectionHeader } from './SectionHeader'

type Props = {
  kit: Kit
  id: string
  title: string
  count: number
  commits: Commit[]
  direction: 'in' | 'out'
  isOpen: boolean
  onToggle: OnPress
}

export function CommitList(props: Props) {
  const { Box, Text } = props.kit
  const { id, commits, direction } = props
  if (props.count === 0) return null

  return (
    <Box flexDirection="column">
      <SectionHeader kit={props.kit} id={id} title={props.title} count={props.count} isOpen={props.isOpen} onToggle={props.onToggle} />
      {props.isOpen &&
        commits.map(one => (
          <Box key={`${id}:${one.hash}`} flexDirection="row" gap="sm" alignItems="center" paddingLeft={2}>
            <Text color={direction === 'in' ? 'suggestion' : 'warning'}>{direction === 'in' ? '↓' : '↑'}</Text>
            <Box flexGrow={1} flexShrink={1}>
              <Text wrap="truncate-end">{one.subject}</Text>
            </Box>
            <Text size="footnote" dimColor wrap="truncate-end">
              <Text mono>{one.hash}</Text> · {one.author} · {one.when}
            </Text>
          </Box>
        ))}
    </Box>
  )
}
