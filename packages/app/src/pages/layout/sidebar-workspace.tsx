import { useNavigate, useParams } from "@solidjs/router"
import { createEffect, createMemo, createSignal, For, Show, type Accessor, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { createSortable, DragDropProvider, DragDropSensors, SortableProvider, closestCenter, type DragEvent } from "@thisbeyond/solid-dnd"
import { createMediaQuery } from "@solid-primitives/media"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { getFilename } from "@opencode-ai/core/util/path"
import { Button } from "@opencode-ai/ui/button"
import { Collapsible } from "@opencode-ai/ui/collapsible"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Spinner } from "@opencode-ai/ui/spinner"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { type Session } from "@opencode-ai/sdk/v2/client"
import { type LocalProject } from "@/context/layout"
import { loadSessionsQuery, useGlobalSync } from "@/context/global-sync"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLanguage } from "@/context/language"
import { NewSessionItem, SessionItem, SessionSkeleton } from "./sidebar-items"
import { groupSessionsByTag, sortedRootSessions, sortSessionsBy, workspaceKey } from "./helpers"
import { useQuery } from "@tanstack/solid-query"

type ArchiveFilter = "active" | "archived" | "all"
const ARCHIVE_FILTER_VALUES: ArchiveFilter[] = ["all", "active", "archived"]
const isArchiveFilter = (value: unknown): value is ArchiveFilter =>
  typeof value === "string" && (ARCHIVE_FILTER_VALUES as string[]).includes(value)
const ARCHIVE_FILTER_LABEL: Record<ArchiveFilter, string> = {
  all: "전체",
  active: "활성",
  archived: "보관",
}

type InlineEditorComponent = (props: {
  id: string
  value: Accessor<string>
  onSave: (next: string) => void
  class?: string
  displayClass?: string
  editing?: boolean
  stopPropagation?: boolean
  openOnDblClick?: boolean
}) => JSX.Element

export type WorkspaceSidebarContext = {
  currentDir: Accessor<string>
  navList: Accessor<Session[]>
  sidebarExpanded: Accessor<boolean>
  sidebarHovering: Accessor<boolean>
  clearHoverProjectSoon: () => void
  prefetchSession: (session: Session, priority?: "high" | "low") => void
  archiveSession: (session: Session) => Promise<void>
  unarchiveSession: (session: Session) => Promise<void>
  workspaceName: (directory: string, projectId?: string, branch?: string) => string | undefined
  renameWorkspace: (directory: string, next: string, projectId?: string, branch?: string) => void
  editorOpen: (id: string) => boolean
  openEditor: (id: string, value: string) => void
  closeEditor: () => void
  setEditor: (key: "value", value: string) => void
  InlineEditor: InlineEditorComponent
  isBusy: (directory: string) => boolean
  workspaceExpanded: (directory: string, local: boolean) => boolean
  setWorkspaceExpanded: (directory: string, value: boolean) => void
  showResetWorkspaceDialog: (root: string, directory: string) => void
  showDeleteWorkspaceDialog: (root: string, directory: string) => void
  setScrollContainerRef: (el: HTMLDivElement | undefined, mobile?: boolean) => void
}

export const WorkspaceDragOverlay = (props: {
  sidebarProject: Accessor<LocalProject | undefined>
  activeWorkspace: Accessor<string | undefined>
  workspaceLabel: (directory: string, branch?: string, projectId?: string) => string
}): JSX.Element => {
  const globalSync = useGlobalSync()
  const language = useLanguage()
  const label = createMemo(() => {
    const project = props.sidebarProject()
    if (!project) return
    const directory = props.activeWorkspace()
    if (!directory) return

    const [workspaceStore] = globalSync.child(directory, { bootstrap: false })
    const kind =
      directory === project.worktree ? language.t("workspace.type.local") : language.t("workspace.type.sandbox")
    const name = props.workspaceLabel(directory, workspaceStore.vcs?.branch, project.id)
    return `${kind} : ${name}`
  })

  return (
    <Show when={label()}>
      {(value) => <div class="bg-background-base rounded-md px-2 py-1 text-14-medium text-text-strong">{value()}</div>}
    </Show>
  )
}

const WorkspaceHeader = (props: {
  local: Accessor<boolean>
  busy: Accessor<boolean>
  open: Accessor<boolean>
  directory: string
  language: ReturnType<typeof useLanguage>
  branch: Accessor<string | undefined>
  workspaceValue: Accessor<string>
  workspaceEditActive: Accessor<boolean>
  InlineEditor: WorkspaceSidebarContext["InlineEditor"]
  renameWorkspace: WorkspaceSidebarContext["renameWorkspace"]
  setEditor: WorkspaceSidebarContext["setEditor"]
  projectId?: string
}): JSX.Element => (
  <div class="flex items-center gap-1 min-w-0 flex-1">
    <div class="flex items-center justify-center shrink-0 size-6">
      <Show when={props.busy()} fallback={<Icon name="branch" size="small" />}>
        <Spinner class="size-[15px]" />
      </Show>
    </div>
    <span class="text-14-medium text-text-base shrink-0">
      {props.local() ? props.language.t("workspace.type.local") : props.language.t("workspace.type.sandbox")} :
    </span>
    <Show
      when={!props.local()}
      fallback={
        <span class="text-14-medium text-text-base min-w-0 truncate">
          {props.branch() ?? getFilename(props.directory)}
        </span>
      }
    >
      <props.InlineEditor
        id={`workspace:${props.directory}`}
        value={props.workspaceValue}
        onSave={(next) => {
          const trimmed = next.trim()
          if (!trimmed) return
          props.renameWorkspace(props.directory, trimmed, props.projectId, props.branch())
          props.setEditor("value", props.workspaceValue())
        }}
        class="text-14-medium text-text-base min-w-0 truncate"
        displayClass="text-14-medium text-text-base min-w-0 truncate"
        editing={props.workspaceEditActive()}
        stopPropagation={false}
        openOnDblClick={false}
      />
    </Show>
    <div class="flex items-center justify-center shrink-0 overflow-hidden w-0 opacity-0 transition-all duration-200 group-hover/workspace:w-3.5 group-hover/workspace:opacity-100 group-focus-within/workspace:w-3.5 group-focus-within/workspace:opacity-100">
      <Icon name={props.open() ? "chevron-down" : "chevron-right"} size="small" class="text-icon-base" />
    </div>
  </div>
)

const WorkspaceActions = (props: {
  directory: string
  local: Accessor<boolean>
  busy: Accessor<boolean>
  menuOpen: Accessor<boolean>
  pendingRename: Accessor<boolean>
  setMenuOpen: (open: boolean) => void
  setPendingRename: (value: boolean) => void
  sidebarHovering: Accessor<boolean>
  touch: Accessor<boolean>
  language: ReturnType<typeof useLanguage>
  workspaceValue: Accessor<string>
  openEditor: WorkspaceSidebarContext["openEditor"]
  showResetWorkspaceDialog: WorkspaceSidebarContext["showResetWorkspaceDialog"]
  showDeleteWorkspaceDialog: WorkspaceSidebarContext["showDeleteWorkspaceDialog"]
  root: string
  clearHoverProjectSoon: WorkspaceSidebarContext["clearHoverProjectSoon"]
  navigateToNewSession: () => void
}): JSX.Element => (
  <div
    class="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 transition-opacity"
    classList={{
      "opacity-100 pointer-events-auto": props.menuOpen(),
      "opacity-0 pointer-events-none": !props.menuOpen(),
      "group-hover/workspace:opacity-100 group-hover/workspace:pointer-events-auto": true,
      "group-focus-within/workspace:opacity-100 group-focus-within/workspace:pointer-events-auto": true,
    }}
  >
    <DropdownMenu
      modal={!props.sidebarHovering()}
      open={props.menuOpen()}
      onOpenChange={(open) => props.setMenuOpen(open)}
    >
      <Tooltip value={props.language.t("common.moreOptions")} placement="top">
        <DropdownMenu.Trigger
          as={IconButton}
          icon="dot-grid"
          variant="ghost"
          class="size-6 rounded-md"
          data-action="workspace-menu"
          data-workspace={base64Encode(props.directory)}
          aria-label={props.language.t("common.moreOptions")}
        />
      </Tooltip>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          onCloseAutoFocus={(event) => {
            if (!props.pendingRename()) return
            event.preventDefault()
            props.setPendingRename(false)
            props.openEditor(`workspace:${props.directory}`, props.workspaceValue())
          }}
        >
          <DropdownMenu.Item
            disabled={props.local()}
            onSelect={() => {
              props.setPendingRename(true)
              props.setMenuOpen(false)
            }}
          >
            <DropdownMenu.ItemLabel>{props.language.t("common.rename")}</DropdownMenu.ItemLabel>
          </DropdownMenu.Item>
          <DropdownMenu.Item
            disabled={props.local() || props.busy()}
            onSelect={() => props.showResetWorkspaceDialog(props.root, props.directory)}
          >
            <DropdownMenu.ItemLabel>{props.language.t("common.reset")}</DropdownMenu.ItemLabel>
          </DropdownMenu.Item>
          <DropdownMenu.Item
            disabled={props.local() || props.busy()}
            onSelect={() => props.showDeleteWorkspaceDialog(props.root, props.directory)}
          >
            <DropdownMenu.ItemLabel>{props.language.t("common.delete")}</DropdownMenu.ItemLabel>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu>
    <Show when={!props.touch()}>
      <Tooltip value={props.language.t("command.session.new")} placement="top">
        <IconButton
          icon="new-session"
          variant="ghost"
          class="size-6 rounded-md opacity-0 pointer-events-none group-hover/workspace:opacity-100 group-hover/workspace:pointer-events-auto group-focus-within/workspace:opacity-100 group-focus-within/workspace:pointer-events-auto"
          data-action="workspace-new-session"
          data-workspace={base64Encode(props.directory)}
          aria-label={props.language.t("command.session.new")}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            props.clearHoverProjectSoon()
            props.navigateToNewSession()
          }}
        />
      </Tooltip>
    </Show>
  </div>
)

const WorkspaceSessionList = (props: {
  slug: Accessor<string>
  mobile?: boolean
  ctx: WorkspaceSidebarContext
  showNew: Accessor<boolean>
  loading: Accessor<boolean>
  sessions: Accessor<Session[]>
  hasMore: Accessor<boolean>
  loadMore: () => Promise<void>
  language: ReturnType<typeof useLanguage>
}): JSX.Element => (
  <nav class="flex flex-col gap-1">
    <Show when={props.showNew()}>
      <NewSessionItem
        slug={props.slug()}
        mobile={props.mobile}
        sidebarExpanded={props.ctx.sidebarExpanded}
        clearHoverProjectSoon={props.ctx.clearHoverProjectSoon}
      />
    </Show>
    <Show when={props.loading()}>
      <SessionSkeleton />
    </Show>
    <For each={props.sessions()}>
      {(session) => (
        <SessionItem
          session={session}
          list={props.sessions()}
          navList={props.ctx.navList}
          slug={props.slug()}
          mobile={props.mobile}
          showChild
          sidebarExpanded={props.ctx.sidebarExpanded}
          clearHoverProjectSoon={props.ctx.clearHoverProjectSoon}
          prefetchSession={props.ctx.prefetchSession}
          archiveSession={props.ctx.archiveSession}
          unarchiveSession={props.ctx.unarchiveSession}
        />
      )}
    </For>
    <Show when={props.hasMore()}>
      <div class="relative w-full py-1">
        <Button
          variant="ghost"
          class="flex w-full text-left justify-start text-14-regular text-text-weak pl-2 pr-10"
          size="large"
          onClick={(e: MouseEvent) => {
            void props.loadMore()
            ;(e.currentTarget as HTMLButtonElement).blur()
          }}
        >
          {props.language.t("common.loadMore")}
        </Button>
      </div>
    </Show>
  </nav>
)

export const SortableWorkspace = (props: {
  ctx: WorkspaceSidebarContext
  directory: string
  project: LocalProject
  sortNow: Accessor<number>
  mobile?: boolean
}): JSX.Element => {
  const navigate = useNavigate()
  const params = useParams()
  const globalSync = useGlobalSync()
  const language = useLanguage()
  const sortable = createSortable(props.directory)
  const [workspaceStore, setWorkspaceStore] = globalSync.child(props.directory, { bootstrap: false })
  const [menu, setMenu] = createStore({
    open: false,
    pendingRename: false,
  })
  const slug = createMemo(() => base64Encode(props.directory))
  const sessions = createMemo(() => sortedRootSessions(workspaceStore, props.sortNow()))
  const local = createMemo(() => props.directory === props.project.worktree)
  const active = createMemo(() => workspaceKey(props.ctx.currentDir()) === workspaceKey(props.directory))
  const workspaceValue = createMemo(() => {
    const branch = workspaceStore.vcs?.branch
    const name = branch ?? getFilename(props.directory)
    return props.ctx.workspaceName(props.directory, props.project.id, branch) ?? name
  })
  const open = createMemo(() => props.ctx.workspaceExpanded(props.directory, local()))
  const boot = createMemo(() => open() || active())
  const count = createMemo(() => sessions()?.length ?? 0)
  const hasMore = createMemo(() => workspaceStore.sessionTotal > count())
  const query = useQuery(() => ({ ...loadSessionsQuery(props.project.worktree) }))
  const busy = createMemo(() => props.ctx.isBusy(props.directory))
  const loading = () => query.isLoading && count() === 0
  const touch = createMediaQuery("(hover: none)")
  const showNew = createMemo(() => !loading() && (touch() || count() === 0 || (active() && !params.id)))
  const loadMore = async () => {
    setWorkspaceStore("limit", (limit) => (limit ?? 0) + 5)
    await globalSync.project.loadSessions(props.directory)
  }

  const workspaceEditActive = createMemo(() => props.ctx.editorOpen(`workspace:${props.directory}`))
  const header = () => (
    <WorkspaceHeader
      local={local}
      busy={busy}
      open={open}
      directory={props.directory}
      language={language}
      branch={() => workspaceStore.vcs?.branch}
      workspaceValue={workspaceValue}
      workspaceEditActive={workspaceEditActive}
      InlineEditor={props.ctx.InlineEditor}
      renameWorkspace={props.ctx.renameWorkspace}
      setEditor={props.ctx.setEditor}
      projectId={props.project.id}
    />
  )

  const openWrapper = (value: boolean) => {
    props.ctx.setWorkspaceExpanded(props.directory, value)
    if (value) return
    if (props.ctx.editorOpen(`workspace:${props.directory}`)) props.ctx.closeEditor()
  }

  createEffect(() => {
    if (!boot()) return
    globalSync.child(props.directory, { bootstrap: true })
  })

  return (
    <div
      // @ts-ignore
      use:sortable
      classList={{
        "opacity-30": sortable.isActiveDraggable,
        "opacity-50 pointer-events-none": busy(),
      }}
    >
      <Collapsible variant="ghost" open={open()} class="shrink-0" onOpenChange={openWrapper}>
        <div class="py-1">
          <div
            class="group/workspace relative"
            data-component="workspace-item"
            data-workspace={base64Encode(props.directory)}
          >
            <div class="flex items-center gap-1">
              <Show
                when={workspaceEditActive()}
                fallback={
                  <Collapsible.Trigger
                    class={`flex items-center justify-between w-full pl-2 py-1.5 rounded-md hover:bg-surface-raised-base-hover transition-[padding] duration-200 ${
                      menu.open ? "pr-16" : "pr-2"
                    } group-hover/workspace:pr-16 group-focus-within/workspace:pr-16`}
                    data-action="workspace-toggle"
                    data-workspace={base64Encode(props.directory)}
                  >
                    {header()}
                  </Collapsible.Trigger>
                }
              >
                <div
                  class={`flex items-center justify-between w-full pl-2 py-1.5 rounded-md transition-[padding] duration-200 ${
                    menu.open ? "pr-16" : "pr-2"
                  } group-hover/workspace:pr-16 group-focus-within/workspace:pr-16`}
                >
                  {header()}
                </div>
              </Show>
              <WorkspaceActions
                directory={props.directory}
                local={local}
                busy={busy}
                menuOpen={() => menu.open}
                pendingRename={() => menu.pendingRename}
                setMenuOpen={(open) => setMenu("open", open)}
                setPendingRename={(value) => setMenu("pendingRename", value)}
                sidebarHovering={props.ctx.sidebarHovering}
                touch={touch}
                language={language}
                workspaceValue={workspaceValue}
                openEditor={props.ctx.openEditor}
                showResetWorkspaceDialog={props.ctx.showResetWorkspaceDialog}
                showDeleteWorkspaceDialog={props.ctx.showDeleteWorkspaceDialog}
                root={props.project.worktree}
                clearHoverProjectSoon={props.ctx.clearHoverProjectSoon}
                navigateToNewSession={() => navigate(`/${slug()}/session`)}
              />
            </div>
          </div>
        </div>

        <Collapsible.Content>
          <WorkspaceSessionList
            slug={slug}
            mobile={props.mobile}
            ctx={props.ctx}
            showNew={showNew}
            loading={() => query.isLoading && count() === 0}
            sessions={sessions}
            hasMore={hasMore}
            loadMore={loadMore}
            language={language}
          />
        </Collapsible.Content>
      </Collapsible>
    </div>
  )
}

export const LocalWorkspace = (props: {
  ctx: WorkspaceSidebarContext
  project: LocalProject
  sortNow: Accessor<number>
  mobile?: boolean
}): JSX.Element => {
  const globalSync = useGlobalSync()
  const globalSDK = useGlobalSDK()
  const workspace = createMemo(() => {
    const [store, setStore] = globalSync.child(props.project.worktree)
    return { store, setStore }
  })
  const slug = createMemo(() => base64Encode(props.project.worktree))

  const archiveFilterKey = createMemo(
    () => `opencode:archive-filter:${workspaceKey(props.project.worktree)}`,
  )
  const readArchiveFilter = (): ArchiveFilter => {
    try {
      const raw = localStorage.getItem(archiveFilterKey())
      if (isArchiveFilter(raw)) return raw
    } catch {}
    return "active"
  }
  const [archiveFilter, setArchiveFilterValue] = createSignal<ArchiveFilter>(readArchiveFilter())
  const setArchiveFilter = (value: ArchiveFilter) => {
    setArchiveFilterValue(value)
    try {
      localStorage.setItem(archiveFilterKey(), value)
    } catch {}
  }
  createEffect(() => {
    archiveFilterKey()
    setArchiveFilterValue(readArchiveFilter())
  })

  const [archivedSessions, setArchivedSessions] = createSignal<Session[]>([])
  const [archivedLoading, setArchivedLoading] = createSignal(false)
  createEffect(() => {
    const mode = archiveFilter()
    if (mode === "active") return
    const directory = props.project.worktree
    const key = workspaceKey(directory)
    setArchivedLoading(true)
    globalSDK.client.session
      .list({ directory, onlyArchived: true, limit: 10000 })
      .then((result) => {
        const list = (result.data ?? [])
          .filter((s): s is Session => !!s?.id && !s.parentID)
          .filter((s) => workspaceKey(s.directory) === key)
        setArchivedSessions(list)
      })
      .catch((err) => console.error("Failed to load archived sessions", err))
      .finally(() => setArchivedLoading(false))
  })

  const activeSessions = createMemo(() => {
    const key = workspaceKey(props.project.worktree)
    const all = workspace().store.session ?? []
    return all.filter((s) => workspaceKey(s.directory) === key && !s.parentID && !s.time?.archived)
  })
  const sessions = createMemo(() => {
    const mode = archiveFilter()
    const activeIDs = new Set(activeSessions().map((s) => s.id))
    const archivedUnique = archivedSessions().filter((s) => !activeIDs.has(s.id))
    const list =
      mode === "active"
        ? activeSessions()
        : mode === "archived"
          ? archivedUnique
          : [...activeSessions(), ...archivedUnique]
    return list.slice().sort(sortSessionsBy(props.sortNow()))
  })
  const archivedIDs = createMemo(() => {
    const activeIDs = new Set(activeSessions().map((s) => s.id))
    return new Set(archivedSessions().filter((s) => !activeIDs.has(s.id)).map((s) => s.id))
  })

  const handleArchive = async (session: Session) => {
    setArchivedSessions((prev) => {
      if (prev.some((s) => s.id === session.id)) return prev
      return [...prev, { ...session, time: { ...session.time, archived: Date.now() } }]
    })
    try {
      await props.ctx.archiveSession(session)
    } catch (err) {
      setArchivedSessions((prev) => prev.filter((s) => s.id !== session.id))
      throw err
    }
  }

  const handleUnarchive = async (session: Session) => {
    const snapshot = archivedSessions()
    setArchivedSessions((prev) => prev.filter((s) => s.id !== session.id))
    try {
      await props.ctx.unarchiveSession(session)
    } catch (err) {
      setArchivedSessions(snapshot)
      throw err
    }
  }
  const groups = createMemo(() => groupSessionsByTag(sessions()))
  const count = createMemo(() => sessions()?.length ?? 0)
  const query = useQuery(() => ({ ...loadSessionsQuery(props.project.worktree) }))
  const hasMore = createMemo(() => workspace().store.sessionTotal > activeSessions().length)
  const loading = () => (query.isLoading && count() === 0) || (archivedLoading() && count() === 0)
  const loadMore = async () => {
    workspace().setStore("limit", 10000)
    await globalSync.project.loadSessions(props.project.worktree)
  }

  const [expanded, setExpanded] = createStore<Record<string, boolean>>({})
  const isExpanded = (tag: string) => expanded[tag] !== false

  const orderKey = createMemo(() => `opencode:tag-order:${workspaceKey(props.project.worktree)}`)
  const readOrder = (): string[] => {
    try {
      const raw = localStorage.getItem(orderKey())
      const parsed = raw ? JSON.parse(raw) : []
      return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : []
    } catch {
      return []
    }
  }
  const [order, setOrder] = createStore<{ value: string[] }>({ value: readOrder() })
  createEffect(() => {
    orderKey()
    setOrder("value", readOrder())
  })

  const draggableGroups = createMemo(() => {
    const all = groups().filter((g) => g.tag !== "기타")
    const map = new Map(all.map((g) => [g.tag, g]))
    const ordered: typeof all = []
    for (const tag of order.value) {
      const g = map.get(tag)
      if (!g) continue
      ordered.push(g)
      map.delete(tag)
    }
    const remaining = [...map.values()].sort((a, b) => a.tag.localeCompare(b.tag))
    return [...ordered, ...remaining]
  })
  const pinnedGroup = createMemo(() => groups().find((g) => g.tag === "기타"))

  createEffect(() => {
    count()
    if (!loading() && hasMore()) void loadMore()
  })

  // Force re-fetch when worktree switches (per-folder filtering)
  createEffect(() => {
    props.project.worktree
    void loadMore()
  })

  function handleDragEnd(event: DragEvent) {
    const { draggable, droppable } = event
    if (!draggable || !droppable) return
    const tags = draggableGroups().map((g) => g.tag)
    const fromIndex = tags.indexOf(draggable.id.toString())
    const toIndex = tags.indexOf(droppable.id.toString())
    if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return
    const result = tags.slice()
    const [item] = result.splice(fromIndex, 1)
    if (!item) return
    result.splice(toIndex, 0, item)
    setOrder("value", result)
    try {
      localStorage.setItem(orderKey(), JSON.stringify(result))
    } catch {}
  }

  const setAllExpanded = (value: boolean) => {
    for (const g of groups()) setExpanded(g.tag, value)
  }

  const renderGroup = (group: { tag: string; sessions: Session[] }) => (
    <Collapsible
      variant="ghost"
      open={isExpanded(group.tag)}
      onOpenChange={(value) => setExpanded(group.tag, value)}
      class="shrink-0"
    >
      <div class="py-0.5">
        <Collapsible.Trigger class="flex items-center w-full pl-2 pr-2 py-1 rounded-md hover:bg-surface-raised-base-hover">
          <div class="flex items-center gap-1.5 min-w-0 flex-1">
            <Icon
              name={isExpanded(group.tag) ? "chevron-down" : "chevron-right"}
              size="small"
              class="text-icon-base shrink-0"
            />
            <span class="text-13-medium text-text-weak min-w-0 truncate">{group.tag}</span>
            <span class="text-12-regular text-text-weak shrink-0">{group.sessions.length}</span>
          </div>
        </Collapsible.Trigger>
      </div>
      <Collapsible.Content>
        <nav class="flex flex-col gap-1">
          <For each={group.sessions}>
            {(session) => (
              <SessionItem
                session={session}
                list={sessions()}
                navList={props.ctx.navList}
                slug={slug()}
                mobile={props.mobile}
                showChild
                sidebarExpanded={props.ctx.sidebarExpanded}
                clearHoverProjectSoon={props.ctx.clearHoverProjectSoon}
                prefetchSession={props.ctx.prefetchSession}
                archiveSession={handleArchive}
                unarchiveSession={handleUnarchive}
                dim={archiveFilter() === "all" && archivedIDs().has(session.id)}
              />
            )}
          </For>
        </nav>
      </Collapsible.Content>
    </Collapsible>
  )

  const DraggableGroup = (p: { group: { tag: string; sessions: Session[] } }) => {
    const sortable = createSortable(p.group.tag)
    return (
      <div
        // @ts-ignore
        use:sortable
        classList={{ "opacity-30": sortable.isActiveDraggable }}
      >
        {renderGroup(p.group)}
      </div>
    )
  }

  return (
    <div
      ref={(el) => props.ctx.setScrollContainerRef(el, props.mobile)}
      class="size-full flex flex-col py-2 overflow-y-auto no-scrollbar [overflow-anchor:none]"
    >
      <Show when={loading()}>
        <SessionSkeleton />
      </Show>
      <div class="flex items-center justify-end gap-0.5 px-2 pb-1">
        <DropdownMenu>
          <Tooltip value="상태 필터" placement="top">
            <DropdownMenu.Trigger
              as={Button}
              variant="ghost"
              size="small"
              class="h-6 px-2 gap-1 text-12-regular text-text-weak"
              aria-label="세션 상태 필터"
            >
              <Icon name="sliders" size="small" />
              <span>{ARCHIVE_FILTER_LABEL[archiveFilter()]}</span>
            </DropdownMenu.Trigger>
          </Tooltip>
          <DropdownMenu.Portal>
            <DropdownMenu.Content>
              <For each={ARCHIVE_FILTER_VALUES}>
                {(value) => (
                  <DropdownMenu.Item onSelect={() => setArchiveFilter(value)}>
                    <DropdownMenu.ItemLabel>{ARCHIVE_FILTER_LABEL[value]}</DropdownMenu.ItemLabel>
                    <Show when={archiveFilter() === value}>
                      <Icon name="check" size="small" class="ml-auto text-icon-base" />
                    </Show>
                  </DropdownMenu.Item>
                )}
              </For>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu>
        <Show when={groups().length > 0}>
          <Tooltip value="전체 펼치기" placement="top">
            <IconButton
              icon="expand"
              variant="ghost"
              class="size-6 rounded-md"
              aria-label="전체 펼치기"
              onClick={() => setAllExpanded(true)}
            />
          </Tooltip>
          <Tooltip value="전체 접기" placement="top">
            <IconButton
              icon="collapse"
              variant="ghost"
              class="size-6 rounded-md"
              aria-label="전체 접기"
              onClick={() => setAllExpanded(false)}
            />
          </Tooltip>
        </Show>
      </div>
      <DragDropProvider onDragEnd={handleDragEnd} collisionDetector={closestCenter}>
        <DragDropSensors />
        <SortableProvider ids={draggableGroups().map((g) => g.tag)}>
          <For each={draggableGroups()}>{(group) => <DraggableGroup group={group} />}</For>
        </SortableProvider>
      </DragDropProvider>
      <Show when={pinnedGroup()} keyed>{(group) => renderGroup(group)}</Show>
    </div>
  )
}
