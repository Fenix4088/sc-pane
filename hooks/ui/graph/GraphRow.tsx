// One commit row of the graph: lanes, ref labels, the subject (the click target) and a short age (FR-GR-4, FR-GR-5).
import type { GraphCommit } from '../../../types'
import { ON_TONE, TINT } from '../../constants'
import { laneCells, laneTone } from '../../helpers/lanes'
import { middleCut, shortAge, shortSubject } from '../../helpers/text'
import type { Kit, LaneCell, LaneRow, OnPress, RefPill } from '../../types'

type Props = {
  kit: Kit
  commit: GraphCommit
  lane: LaneRow | undefined
  // Lanes drawn in every row, so messages start in one column.
  lanes: number
  pills: RefPill[]
  // The pane's width in cells, to cut the subject so the row stays one line.
  columns: number
  isSelected: boolean
  onSelect: OnPress
}

export function GraphRow(props: Props) {
  const { Box, Text, Button } = props.kit
  const { commit, lane, lanes, isSelected } = props
  // Labels give way to the subject: one in a narrow pane, two in a wide one, each cut to a third of the row.
  const shown = props.pills
    .slice(0, props.columns >= 80 ? 2 : 1)
    .map(pill => ({ ...pill, text: middleCut(pill.text, Math.max(12, Math.floor(props.columns / 3))) }))
  const extra = props.pills.length - shown.length
  const tone = laneTone(lane?.col ?? 0)
  const pillChars = shown.reduce((sum, pill) => sum + pill.text.length + 3, 0) + (extra > 0 ? 4 : 0)
  const subject = shortSubject(commit.subject, Math.max(16, props.columns - lanes * 2 - pillChars - 8))

  return (
    <Box
      key={`graph:${commit.hash}`}
      flexDirection="row"
      alignItems="center"
      gap="sm"
      backgroundColor={isSelected && props.kit.isDesktop ? TINT.selected : undefined}
    >
      <Lanes kit={props.kit} cells={lane ? laneCells(lane, lanes) : []} lanes={lanes} />
      {shown.map(pill => (
        <Box flexShrink={1}>
          {pill.isHead ? (
            <Text size="footnote" weight="semibold" color={ON_TONE} backgroundColor={tone} wrap="truncate-middle">
              {` ${pill.text} `}
            </Text>
          ) : (
            <Text size="footnote" weight="semibold" color={tone} wrap="truncate-middle">
              {pill.text}
            </Text>
          )}
        </Box>
      ))}
      {extra > 0 && (
        <Text size="footnote" dimColor>
          {`+${extra}`}
        </Text>
      )}
      <Box flexGrow={1} flexShrink={1}>
        <Button key={`commit:${commit.hash}`} label={subject || '(no message)'} plain onPress={props.onSelect} />
      </Box>
      <Box width={4} flexShrink={0} justifyContent="flex-end">
        <Text size="footnote" dimColor tabular>
          {shortAge(commit.when)}
        </Text>
      </Box>
    </Box>
  )
}

// Coloured box-drawing text, two cells per lane; the block never shrinks.
export function Lanes(props: { kit: Kit; cells: LaneCell[]; lanes: number }) {
  const { Box, Text } = props.kit

  return (
    <Box flexDirection="row" width={props.lanes * 2} flexShrink={0}>
      {props.cells.map(cell => (
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
