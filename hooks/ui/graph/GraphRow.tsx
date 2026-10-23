// One commit row of the graph: lanes, hash, ↓/↑, refs, subject, author and age (FR-GR-4 to 6).
import type { GraphCommit } from '../../../types'
import { laneCells, laneTone } from '../../helpers/lanes'
import { shortSubject } from '../../helpers/text'
import type { Kit, LaneRow, OnPress } from '../../types'

type Props = {
  kit: Kit
  commit: GraphCommit
  lane: LaneRow | undefined
  // Lanes drawn in every row, so messages start in one column.
  lanes: number
  isSelected: boolean
  isIncoming: boolean
  isOutgoing: boolean
  // The full subject shows on hover where the pointer is reported; elsewhere the open commit shows it.
  canHover: boolean
  onSelect: OnPress
}

export function GraphRow(props: Props) {
  const { Box, Text, Button } = props.kit
  const { commit, lanes, isSelected } = props
  const shownRefs = commit.refs.slice(0, 2)
  const subject = shortSubject(commit.subject)
  const isCut = subject !== commit.subject

  return (
    <Box key={`graph:${commit.hash}`} flexDirection="row" alignItems="center" gap="sm">
      <Lanes kit={props.kit} lane={props.lane} lanes={lanes} />
      <Button key={`commit:${commit.hash}`} label={commit.hash} plain dimColor={!isSelected} onPress={props.onSelect} />
      {props.isIncoming && <Text color="suggestion">↓</Text>}
      {props.isOutgoing && <Text color="warning">↑</Text>}
      {shownRefs.map(ref => (
        <Text size="footnote" weight="semibold" color={ref.startsWith('HEAD') ? 'success' : 'suggestion'} wrap="truncate-middle">
          {ref}
        </Text>
      ))}
      {commit.refs.length > shownRefs.length && (
        <Text size="footnote" dimColor>
          {`+${commit.refs.length - shownRefs.length}`}
        </Text>
      )}
      <Box flexGrow={1} flexShrink={1}>
        <Text wrap="truncate-end" weight={isSelected ? 'semibold' : 'regular'}>
          {subject}
        </Text>
      </Box>
      <Text size="footnote" dimColor wrap="truncate-end">
        {`${commit.author} · ${commit.when}`}
      </Text>
      {isCut && props.canHover && (
        <Box position="absolute" top={1} left={lanes * 2 + 10} display="none" hover={{ display: 'flex' }}>
          <Text inverse wrap="wrap">
            {` ${commit.subject} `}
          </Text>
        </Box>
      )}
    </Box>
  )
}

// Coloured box-drawing text, two cells per lane; the block never shrinks.
function Lanes(props: { kit: Kit; lane: LaneRow | undefined; lanes: number }) {
  const { Box, Text } = props.kit

  return (
    <Box flexDirection="row" width={props.lanes * 2} flexShrink={0}>
      {props.lane &&
        laneCells(props.lane, props.lanes).map(cell => (
          <Box flexDirection="row" width={2} flexShrink={0}>
            <Text mono bold color={laneTone(cell.glyphLane)}>
              {cell.glyph}
            </Text>
            <Text mono bold color={laneTone(cell.jointLane)}>
              {cell.joint}
            </Text>
          </Box>
        ))}
    </Box>
  )
}
