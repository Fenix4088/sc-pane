// STAGED and CHANGES with their rows and actions (FR-CHG-1 to 4).
import type { FileChange } from '../../../types'
import { LIST_LIMIT } from '../../constants'
import { plural, splitPath } from '../../helpers/text'
import type { Kit, OnPress } from '../../types'
import { ConfirmRow, FileLine, HoverActions } from '../common'
import { SectionHeader } from './SectionHeader'

type FileKind = 'staged' | 'unstaged'

export type ChangesActions = {
  toggle: (id: string) => OnPress
  ask: (confirm: string) => OnPress
  cancel: OnPress
  stage: (file: FileChange) => OnPress
  unstage: (file: FileChange) => OnPress
  discard: (file: FileChange) => OnPress
  stageAll: OnPress
  unstageAll: OnPress
  discardAll: OnPress
}

type Props = {
  kit: Kit
  staged: FileChange[]
  unstaged: FileChange[]
  collapsed: string[]
  confirm: string | null
  revealOnHover: boolean
  actions: ChangesActions
}

export function Changes(props: Props) {
  const { Box } = props.kit

  return (
    <Box flexDirection="column" gap="sm">
      <StagedSection {...props} />
      <UnstagedSection {...props} />
    </Box>
  )
}

function StagedSection(props: Props) {
  const { Box, Button } = props.kit
  const { staged, collapsed, actions } = props
  if (staged.length === 0) return null

  return (
    <Box flexDirection="column">
      <SectionHeader
        kit={props.kit}
        id="staged"
        title="Staged"
        count={staged.length}
        isOpen={!collapsed.includes('staged')}
        onToggle={actions.toggle('staged')}
        actions={<Button key="unstage-all" label="−" plain dimColor onPress={actions.unstageAll} />}
      />
      <FileList {...props} id="staged" files={staged} kind="staged" />
    </Box>
  )
}

function UnstagedSection(props: Props) {
  const { Box, Button } = props.kit
  const { unstaged, collapsed, actions } = props
  if (unstaged.length === 0) return null

  const untracked = unstaged.filter(file => file.code === 'U').length
  const question =
    `Discard all ${plural(unstaged.length, 'change')}?` +
    (untracked > 0 ? ` ${plural(untracked, 'untracked file')} will be deleted.` : '') +
    ' This cannot be undone.'

  return (
    <Box flexDirection="column">
      <SectionHeader
        kit={props.kit}
        id="changes"
        title="Changes"
        count={unstaged.length}
        isOpen={!collapsed.includes('changes')}
        onToggle={actions.toggle('changes')}
        actions={
          <Box flexDirection="row" gap="sm">
            <Button key="discard-all" label="↺" plain dimColor onPress={actions.ask('all')} />
            <Button key="stage-all" label="+" plain dimColor onPress={actions.stageAll} />
          </Box>
        }
      />
      {props.confirm === 'all' && (
        <ConfirmRow
          kit={props.kit}
          text={question}
          confirmKey="confirm-all"
          cancelKey="cancel-all"
          confirmLabel="Discard all"
          onConfirm={actions.discardAll}
          onCancel={actions.cancel}
          paddingLeft={2}
        />
      )}
      <FileList {...props} id="changes" files={unstaged} kind="unstaged" />
    </Box>
  )
}

function FileList(props: Props & { id: string; files: FileChange[]; kind: FileKind }) {
  const { Box, Text } = props.kit
  const { files } = props
  if (props.collapsed.includes(props.id)) return null

  return (
    <Box flexDirection="column">
      {files.slice(0, LIST_LIMIT).map(file => (
        <FileRow {...props} file={file} />
      ))}
      {files.length > LIST_LIMIT && (
        <Text size="footnote" dimColor>
          …and {files.length - LIST_LIMIT} more
        </Text>
      )}
    </Box>
  )
}

function FileRow(props: Props & { file: FileChange; kind: FileKind }) {
  const { Box, Button } = props.kit
  const { file, kind, actions } = props
  const { name } = splitPath(file.path)
  const isUntracked = file.code === 'U'

  return (
    <Box key={`${kind}:${file.path}`} flexDirection="column">
      <FileLine kit={props.kit} file={file} paddingLeft={2}>
        <HoverActions kit={props.kit} revealOnHover={props.revealOnHover}>
          {kind === 'staged' ? (
            <Button key={`unstage:${file.path}`} label="−" plain dimColor onPress={actions.unstage(file)} />
          ) : (
            [
              <Button key={`discard:${file.path}`} label="↺" plain dimColor onPress={actions.ask(`file:${file.path}`)} />,
              <Button key={`stage:${file.path}`} label="+" plain dimColor onPress={actions.stage(file)} />,
            ]
          )}
        </HoverActions>
      </FileLine>
      {props.confirm === `file:${file.path}` && (
        <ConfirmRow
          kit={props.kit}
          text={isUntracked ? `Delete ${name}? It is not tracked, so this cannot be undone.` : `Discard your changes to ${name}?`}
          confirmKey={`confirm:${file.path}`}
          cancelKey={`cancel:${file.path}`}
          confirmLabel={isUntracked ? 'Delete' : 'Discard'}
          onConfirm={actions.discard(file)}
          onCancel={actions.cancel}
          paddingLeft={4}
        />
      )}
    </Box>
  )
}
