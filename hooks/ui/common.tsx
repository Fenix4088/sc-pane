// Components both panes use. Components never receive `$` (the validator refuses `$` in props):
// they get data, the element kit and ready-made handlers from the pane that draws them.
import type { FileChange, Notice } from '../../types'
import { splitPath } from '../helpers/text'
import { codeColor } from '../helpers/view'
import type { Kit, OnPress } from '../types'

// The running action's label, else the last result (FR-PANE-5).
export function StatusLine(props: { kit: Kit; busy: string | null; notice: Notice | null }) {
  const { Text } = props.kit
  if (props.busy) return <Text color="suggestion">{props.busy}</Text>
  if (props.notice) return <Text color={props.notice.kind === 'ok' ? 'success' : 'error'}>{props.notice.text}</Text>

  return null
}

export function Caption(props: { kit: Kit; text: string }) {
  const { Text } = props.kit

  return (
    <Text size="caption" weight="semibold" bold dimColor>
      {props.text.toUpperCase()}
    </Text>
  )
}

// Status letter, name, dimmed folder and line counts; `children` are the row's actions, drawn last.
export function FileLine(props: {
  kit: Kit
  file: FileChange
  rowKey?: string
  paddingLeft?: number
  children?: JSX.Children
}) {
  const { Box, Text } = props.kit
  const { file } = props
  const { name, dir } = splitPath(file.path)

  return (
    <Box key={props.rowKey} flexDirection="row" gap="sm" alignItems="center" paddingLeft={props.paddingLeft}>
      <Text color={codeColor(file.code)} mono>
        {file.code}
      </Text>
      <Text wrap="truncate-end">{name}</Text>
      <Box flexGrow={1} flexShrink={1}>
        <Text size="footnote" dimColor wrap="truncate-start">
          {dir}
        </Text>
      </Box>
      {file.added !== undefined && file.added > 0 && (
        <Text mono size="footnote" color="success">
          +{file.added}
        </Text>
      )}
      {file.removed !== undefined && file.removed > 0 && (
        <Text mono size="footnote" color="error">
          −{file.removed}
        </Text>
      )}
      {props.children}
    </Box>
  )
}

// Row actions: shown on hover where the pointer is reported (desktop), always on the terminal (NFR-4).
export function HoverActions(props: { kit: Kit; revealOnHover: boolean; children?: JSX.Children }) {
  const { Box } = props.kit

  return (
    <Box
      flexDirection="row"
      gap="xs"
      display={props.revealOnHover ? 'none' : 'flex'}
      hover={props.revealOnHover ? { display: 'flex' } : undefined}
    >
      {props.children}
    </Box>
  )
}

// An inline question with its confirm and Cancel buttons (BR-1).
export function ConfirmRow(props: {
  kit: Kit
  text: string
  confirmKey: string
  cancelKey: string
  confirmLabel: string
  onConfirm: OnPress
  onCancel: OnPress
  paddingLeft?: number
}) {
  const { Box, Text, Button } = props.kit

  return (
    <Box flexDirection="row" gap="sm" alignItems="center" paddingLeft={props.paddingLeft} flexWrap="wrap">
      <Text size="footnote" color="warning">
        {props.text}
      </Text>
      <Button key={props.confirmKey} label={props.confirmLabel} onPress={props.onConfirm} />
      <Button key={props.cancelKey} label="Cancel" dimColor onPress={props.onCancel} />
    </Box>
  )
}
