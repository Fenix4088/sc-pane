// STAGED and CHANGES, as a list or as a folder tree, with their row actions (FR-CHG-1 to 4).
import type { FileChange } from '../../../types'
import { ICON, LIST_LIMIT } from '../../constants'
import { printable, shortDir, splitPath } from '../../helpers/text'
import { fileTree } from '../../helpers/tree'
import { codeColor } from '../../helpers/view'
import type { Kit, OnPress } from '../../types'
import { HoverActions, Icon } from '../common'
import { SectionHeader } from './SectionHeader'

type FileKind = 'staged' | 'changes'

export type ChangesActions = {
  toggle: (id: string) => OnPress
  ask: (confirm: string) => OnPress
  stage: (file: FileChange) => OnPress
  unstage: (file: FileChange) => OnPress
  stageDir: (dir: string) => OnPress
  unstageDir: (dir: string) => OnPress
  stageAll: OnPress
  unstageAll: OnPress
}

type Props = {
  kit: Kit
  staged: FileChange[]
  unstaged: FileChange[]
  collapsed: string[]
  isTree: boolean
  actions: ChangesActions
}

export function Changes(props: Props) {
  const { Box, Button } = props.kit
  const { staged, unstaged, collapsed, actions } = props

  return (
    <Box flexDirection="column" gap="sm">
      {staged.length > 0 && (
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
          <FileList {...props} kind="staged" files={staged} />
        </Box>
      )}
      {unstaged.length > 0 && (
        <Box flexDirection="column">
          <SectionHeader
            kit={props.kit}
            id="changes"
            title="Changes"
            count={unstaged.length}
            isOpen={!collapsed.includes('changes')}
            onToggle={actions.toggle('changes')}
            actions={
              <Box flexDirection="row" gap="xs">
                <Button key="discard-all" label="↺" plain dimColor onPress={actions.ask('all')} />
                <Button key="stage-all" label="+" plain dimColor onPress={actions.stageAll} />
              </Box>
            }
          />
          <FileList {...props} kind="changes" files={unstaged} />
        </Box>
      )}
    </Box>
  )
}

function FileList(props: Props & { kind: FileKind; files: FileChange[] }) {
  const { Box, Text } = props.kit
  const { kind, files, collapsed } = props
  if (collapsed.includes(kind)) return null

  const shown = files.slice(0, LIST_LIMIT)
  const isFolderOpen = (dir: string) => !collapsed.includes(`${kind}:dir:${dir}`)

  return (
    <Box flexDirection="column">
      {props.isTree
        ? fileTree(shown, isFolderOpen).map(row =>
            row.kind === 'folder' ? (
              <FolderRow
                {...props}
                dir={row.dir}
                label={row.label}
                count={row.count}
                depth={row.depth}
                isOpen={isFolderOpen(row.dir)}
              />
            ) : (
              <FileRow {...props} file={row.file} indent={2 * Math.max(1, row.depth)} showDir={false} />
            ),
          )
        : shown.map(file => <FileRow {...props} file={file} indent={2} showDir />)}
      {files.length > LIST_LIMIT && (
        <Box paddingLeft={2}>
          <Text size="footnote" dimColor>
            …and {files.length - LIST_LIMIT} more
          </Text>
        </Box>
      )}
    </Box>
  )
}

// Tree view: ▾/▸, the folder icon, its name and how many changed files it holds; + or − stages the whole folder.
function FolderRow(
  props: Props & { kind: FileKind; dir: string; label: string; count: number; depth: number; isOpen: boolean },
) {
  const { Box, Text, Button } = props.kit
  const { kind, dir, actions } = props

  return (
    <Box key={`folder:${kind}:${dir}`} flexDirection="row" gap="sm" alignItems="center" paddingLeft={2 * props.depth}>
      <Button
        key={`toggle:${kind}:dir:${dir}`}
        label={props.isOpen ? '▾' : '▸'}
        plain
        dimColor
        onPress={actions.toggle(`${kind}:dir:${dir}`)}
      />
      <Icon kit={props.kit} paths={ICON.folder} alt="Folder" size={15} />
      <Box flexShrink={1}>
        <Text wrap="truncate-start">{printable(props.label)}</Text>
      </Box>
      <Box flexGrow={1}>
        <Text size="footnote" dimColor>
          {String(props.count)}
        </Text>
      </Box>
      <HoverActions kit={props.kit}>
        {kind === 'staged' ? (
          <Button key={`unstage-dir:${dir}`} label="−" plain dimColor onPress={actions.unstageDir(dir)} />
        ) : (
          <Button key={`stage-dir:${dir}`} label="+" plain dimColor onPress={actions.stageDir(dir)} />
        )}
      </HoverActions>
    </Box>
  )
}

// The file icon, its name, its folder dimmed (list view), the row actions on hover, and the status letter.
function FileRow(props: Props & { kind: FileKind; file: FileChange; indent: number; showDir: boolean }) {
  const { Box, Text, Button } = props.kit
  const { file, kind, actions } = props
  const { name, dir } = splitPath(file.path)

  return (
    <Box key={`${kind}:${file.path}`} flexDirection="row" gap="sm" alignItems="center" paddingLeft={props.indent}>
      <Icon kit={props.kit} paths={ICON.file} alt="File" />
      <Box flexShrink={1}>
        <Text wrap="truncate-end">{printable(name)}</Text>
      </Box>
      <Box flexGrow={1} flexShrink={1}>
        {props.showDir && dir ? (
          <Text size="footnote" dimColor wrap="truncate-end">
            {printable(shortDir(dir))}
          </Text>
        ) : (
          <Text> </Text>
        )}
      </Box>
      <HoverActions kit={props.kit}>
        {kind === 'staged' ? (
          <Button key={`unstage:${file.path}`} label="−" plain dimColor onPress={actions.unstage(file)} />
        ) : (
          [
            <Button key={`discard:${file.path}`} label="↺" plain dimColor onPress={actions.ask(`file:${file.path}`)} />,
            <Button key={`stage:${file.path}`} label="+" plain dimColor onPress={actions.stage(file)} />,
          ]
        )}
      </HoverActions>
      <Text color={codeColor(file.code)} weight="bold" mono>
        {file.code}
      </Text>
    </Box>
  )
}
