// A clean working tree (FR-CHG-5): one line while out of sync, else the empty state with its badge.
import { CLEAN_BADGE, ICON, TONE } from '../../constants'
import { svg } from '../../helpers/view'
import type { Kit } from '../../types'
import { Caption } from '../common'

export function CleanState(props: { kit: Kit; isOutOfSync: boolean }) {
  const { Box, Text, Svg } = props.kit

  if (props.isOutOfSync) {
    return (
      <Box flexDirection="row" gap="sm" alignItems="center" justifyContent="space-between">
        <Box flexDirection="row" gap="sm" alignItems="center">
          {Svg ? <Svg source={svg(ICON.check, TONE.green, 16)} alt="" width={16} height={16} /> : <Text color="success">✓</Text>}
          <Text weight="medium">Working tree clean</Text>
        </Box>
        <Text size="footnote" dimColor>
          0 changes
        </Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" gap="sm">
      <Box flexDirection="row" gap="sm" alignItems="center">
        <Caption kit={props.kit} text="Changes" />
        <Text mono dimColor>
          0
        </Text>
      </Box>
      <Box flexDirection="column" alignItems="center" gap="sm" paddingY={2}>
        {Svg ? <Svg source={CLEAN_BADGE} alt="Clean" width={44} height={44} /> : <Text color="success">✓</Text>}
        <Text weight="semibold" bold>
          Working tree clean
        </Text>
        <Text size="footnote" dimColor>
          Nothing to commit. Edits you make will show up here.
        </Text>
      </Box>
    </Box>
  )
}
