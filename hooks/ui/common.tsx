// Components both tabs use. Components never receive `$` (the validator refuses `$` in props):
// they get data, the element kit and ready-made handlers from the container that draws them.
import type { Notice, PaneUi } from '../../types'
import { TINT, TONE } from '../constants'
import { svg } from '../helpers/view'
import type { Kit, OnPress } from '../types'

export type TabActions = { showChanges: OnPress; showGraph: OnPress }

// The top bar: the two tabs on the left, the tab's own buttons on the right (FR-PANE-4).
export function TopBar(props: { kit: Kit; tab: PaneUi['tab']; actions: TabActions; children?: JSX.Children }) {
  const { Box } = props.kit
  const { tab, actions } = props

  return (
    <Box flexDirection="row" justifyContent="space-between" alignItems="center">
      <Box flexDirection="row" gap="xs" alignItems="center">
        <Tab kit={props.kit} id="changes" label="Source Control" isCurrent={tab === 'changes'} onPress={actions.showChanges} />
        <Tab kit={props.kit} id="graph" label="Graph" isCurrent={tab === 'graph'} onPress={actions.showGraph} />
      </Box>
      <Box flexDirection="row" gap="xs" alignItems="center">
        {props.children}
      </Box>
    </Box>
  )
}

function Tab(props: { kit: Kit; id: string; label: string; isCurrent: boolean; onPress: OnPress }) {
  const { Text, Button } = props.kit
  if (!props.isCurrent) return <Button key={`tab-${props.id}`} label={props.label} plain dimColor onPress={props.onPress} />

  return (
    <Text weight="semibold" backgroundColor={props.kit.isDesktop ? TINT.neutral : undefined}>
      {props.kit.isDesktop ? ` ${props.label} ` : props.label}
    </Text>
  )
}

// The status line: the running action in the accent colour, else the last result with ✕ to dismiss it.
// Results are green, refusals and failures amber, as the design draws them (FR-PANE-5).
export function Toast(props: { kit: Kit; busy: string | null; notice: Notice | null; onDismiss: OnPress }) {
  const { Box, Text, Button } = props.kit
  if (props.busy) {
    return (
      <Text size="footnote" color="suggestion">
        {props.busy}
      </Text>
    )
  }
  if (!props.notice) return null

  return (
    <Box flexDirection="row" gap="sm" alignItems="flex-start">
      <Box flexGrow={1} flexShrink={1}>
        <Text size="footnote" color={props.notice.kind === 'ok' ? 'success' : 'warning'}>
          {props.notice.text}
        </Text>
      </Box>
      <Button key="dismiss" label="✕" plain dimColor onPress={props.onDismiss} />
    </Box>
  )
}

// A question in an amber card, Cancel then the action, both on the right (BR-1).
export function ConfirmCard(props: {
  kit: Kit
  text: string
  confirmKey: string
  cancelKey: string
  confirmLabel: string
  onConfirm: OnPress
  onCancel: OnPress
}) {
  const { Box, Text, Button } = props.kit

  return (
    <Box flexDirection="column" gap="sm" borderStyle="round" borderColor="warning" paddingX={1}>
      <Text color="warning">{props.text}</Text>
      <Box flexDirection="row" gap="sm" justifyContent="flex-end">
        <Button key={props.cancelKey} label="Cancel" onPress={props.onCancel} />
        <Button key={props.confirmKey} label={props.confirmLabel} variant="primary" onPress={props.onConfirm} />
      </Box>
    </Box>
  )
}

// A dropdown's card: a rounded frame holding its items, drawn in the flow under the button that opened it.
export function MenuCard(props: { kit: Kit; isWide?: boolean; children?: JSX.Children }) {
  const { Box } = props.kit

  return (
    <Box
      flexDirection="column"
      gap="md"
      borderStyle="round"
      borderDimColor
      paddingX={1}
      alignSelf={props.isWide ? undefined : 'flex-end'}
    >
      {props.children}
    </Box>
  )
}

// One group of a dropdown; groups are set apart as the design's dividers set them.
export function MenuGroup(props: { kit: Kit; children?: JSX.Children }) {
  const { Box } = props.kit

  return <Box flexDirection="column">{props.children}</Box>
}

// A command in a dropdown: dimmed when it cannot run, and then pressing it says why (FR-MENU-3).
export function MenuItem(props: { kit: Kit; id: string; label: string; hotkey?: string; isBlocked?: boolean; onPress: OnPress }) {
  const { Button } = props.kit

  return (
    <Button
      key={props.id}
      label={props.label}
      plain
      hotkey={props.hotkey}
      dimColor={props.isBlocked === true}
      onPress={props.onPress}
    />
  )
}

// One of the design's line icons where the surface draws SVG; nothing elsewhere, the text beside it says enough.
export function Icon(props: { kit: Kit; paths: string; alt: string; tone?: string; size?: number }) {
  const { Svg } = props.kit
  const size = props.size ?? 14
  if (!Svg) return null

  return <Svg source={svg(props.paths, props.tone ?? TONE.muted, size)} alt={props.alt} width={size} height={size} />
}

// Row actions: shown on hover where the pointer is reported (desktop), always on the terminal (NFR-4).
export function HoverActions(props: { kit: Kit; children?: JSX.Children }) {
  const { Box } = props.kit
  const { isDesktop } = props.kit

  return (
    <Box
      flexDirection="row"
      gap="xs"
      flexShrink={0}
      display={isDesktop ? 'none' : 'flex'}
      hover={isDesktop ? { display: 'flex' } : undefined}
    >
      {props.children}
    </Box>
  )
}

// A count in a small pill: a translucent ground on desktop, dim text on the terminal.
export function CountPill(props: { kit: Kit; count: number }) {
  const { Text } = props.kit

  return props.kit.isDesktop ? (
    <Text size="caption" tabular backgroundColor={TINT.neutral}>{` ${props.count} `}</Text>
  ) : (
    <Text dimColor>{String(props.count)}</Text>
  )
}
