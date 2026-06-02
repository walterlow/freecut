import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Search, ArrowUpDown, X, Trash2, AlertTriangle, Plus, Upload } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { ProjectCard } from './project-card'
import {
  useFilteredProjects,
  useSortField,
  useSortDirection,
  useFilterResolution,
  useFilterFps,
  useHasActiveFilters,
} from '../hooks/use-project-selectors'
import { useProjectFilters, useDeleteProject } from '../hooks/use-project-actions'
import { getUniqueResolutions, getUniqueFps } from '../utils/project-helpers'
import { useProjects } from '../hooks/use-project-selectors'
import type { Project } from '@/types/project'

interface ProjectListProps {
  onEditProject?: (project: Project) => void
  onImportProject?: () => void
}

interface MarqueeRect {
  x: number
  y: number
  width: number
  height: number
}

const MARQUEE_DRAG_THRESHOLD = 4

export function ProjectList({ onEditProject, onImportProject }: ProjectListProps) {
  const { t } = useTranslation()
  const [localSearchQuery, setLocalSearchQuery] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [anchorId, setAnchorId] = useState<string | null>(null)
  const [showBulkDeleteDialog, setShowBulkDeleteDialog] = useState(false)
  const [isBulkDeleting, setIsBulkDeleting] = useState(false)

  // Marquee state
  const containerRef = useRef<HTMLDivElement>(null)
  const [marquee, setMarquee] = useState<MarqueeRect | null>(null)
  const marqueeStartRef = useRef<{
    x: number
    y: number
    baseSelection: Set<string>
    additive: boolean
  } | null>(null)

  const allProjects = useProjects()
  const filteredProjects = useFilteredProjects()
  const sortField = useSortField()
  const sortDirection = useSortDirection()
  const filterResolution = useFilterResolution()
  const filterFps = useFilterFps()
  const hasActiveFilters = useHasActiveFilters()

  const {
    setSearchQuery,
    setSortField,
    setSortDirection,
    setFilterResolution,
    setFilterFps,
    clearFilters,
  } = useProjectFilters()
  const deleteProject = useDeleteProject()

  const uniqueResolutions = useMemo(() => getUniqueResolutions(allProjects), [allProjects])
  const uniqueFps = useMemo(() => getUniqueFps(allProjects), [allProjects])

  // Prune selections that disappear (e.g. after deletion or filtering changes)
  useEffect(() => {
    const visibleIds = new Set(filteredProjects.map((p) => p.id))
    setSelectedIds((prev) => {
      let changed = false
      const next = new Set<string>()
      for (const id of prev) {
        if (visibleIds.has(id)) {
          next.add(id)
        } else {
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [filteredProjects])

  const handleSearchChange = (value: string) => {
    setLocalSearchQuery(value)
    const timeoutId = setTimeout(() => {
      setSearchQuery(value)
    }, 300)
    return () => clearTimeout(timeoutId)
  }

  const handleClearFilters = () => {
    setLocalSearchQuery('')
    clearFilters()
  }

  const toggleSortDirection = () => {
    setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
  }

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set())
    setAnchorId(null)
  }, [])

  const handleCardClick = useCallback(
    (e: React.MouseEvent, project: Project) => {
      // If marquee actually dragged, cancel click-selection
      if (marqueeStartRef.current) return

      const id = project.id
      if (e.shiftKey && anchorId) {
        // Range select
        const startIdx = filteredProjects.findIndex((p) => p.id === anchorId)
        const endIdx = filteredProjects.findIndex((p) => p.id === id)
        if (startIdx >= 0 && endIdx >= 0) {
          const [from, to] = startIdx <= endIdx ? [startIdx, endIdx] : [endIdx, startIdx]
          const range = filteredProjects.slice(from, to + 1).map((p) => p.id)
          setSelectedIds(new Set(range))
          return
        }
      }

      if (e.ctrlKey || e.metaKey) {
        setSelectedIds((prev) => {
          const next = new Set(prev)
          if (next.has(id)) {
            next.delete(id)
          } else {
            next.add(id)
          }
          return next
        })
        setAnchorId(id)
        return
      }

      // Plain click: select only this one
      setSelectedIds(new Set([id]))
      setAnchorId(id)
    },
    [anchorId, filteredProjects],
  )

  // Marquee/deselect: listen at the document level so it works from the
  // viewport gutters (outside the centered content container), not just
  // inside the grid box.
  useEffect(() => {
    const INTERACTIVE_SELECTOR =
      'button, a, input, textarea, select, label, [role="menu"], [role="menuitem"], [role="dialog"], [role="listbox"], [role="combobox"], [role="option"], [role="alertdialog"], [data-project-card], [data-radix-popper-content-wrapper], [data-radix-dialog-overlay]'

    const isMarqueeBlocked = (target: EventTarget | null): boolean => {
      if (!(target instanceof Element)) return true
      // Block if inside any interactive widget, dropdown, or modal
      if (target.closest(INTERACTIVE_SELECTOR)) return true
      // Block if any modal is open (e.g. Edit dialog, bulk delete confirm)
      if (
        document.querySelector(
          '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]',
        )
      )
        return true
      // Block in the Trash section — it has its own interactions
      if (target.closest('[data-no-marquee]')) return true
      return false
    }

    const handleMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return
      if (!containerRef.current) return // ProjectList not mounted
      if (isMarqueeBlocked(e.target)) return

      const additive = e.ctrlKey || e.metaKey || e.shiftKey
      marqueeStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        baseSelection: additive ? new Set(selectedIds) : new Set(),
        additive,
      }
    }

    const handleMouseMove = (e: MouseEvent) => {
      const start = marqueeStartRef.current
      if (!start) return

      const dx = e.clientX - start.x
      const dy = e.clientY - start.y

      if (!marquee && Math.hypot(dx, dy) < MARQUEE_DRAG_THRESHOLD) return

      // Viewport-space rectangle
      const x = Math.min(start.x, e.clientX)
      const y = Math.min(start.y, e.clientY)
      const width = Math.abs(dx)
      const height = Math.abs(dy)
      const right = x + width
      const bottom = y + height

      setMarquee({ x, y, width, height })

      const hits = new Set<string>(start.baseSelection)
      const cards = document.querySelectorAll<HTMLElement>('[data-project-card]')
      cards.forEach((el) => {
        const r = el.getBoundingClientRect()
        const intersects = r.left < right && r.right > x && r.top < bottom && r.bottom > y
        const id = el.dataset.projectId
        if (!id) return
        if (intersects) {
          if (start.additive && start.baseSelection.has(id)) {
            hits.delete(id)
          } else {
            hits.add(id)
          }
        }
      })
      setSelectedIds(hits)
    }

    const handleMouseUp = () => {
      const wasMarquee = marquee !== null
      const hadStart = marqueeStartRef.current !== null
      marqueeStartRef.current = null
      setMarquee(null)

      // Plain click in the gutter / empty area → deselect
      if (hadStart && !wasMarquee) {
        clearSelection()
      }
    }

    document.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [marquee, clearSelection, selectedIds])

  // Keyboard: Escape clears, Delete triggers bulk delete, Ctrl/Cmd+A selects all
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const inInput =
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      if (inInput) return

      if (e.key === 'Escape' && selectedIds.size > 0) {
        clearSelection()
        return
      }

      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.size > 0) {
        e.preventDefault()
        setShowBulkDeleteDialog(true)
        return
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && filteredProjects.length > 0) {
        e.preventDefault()
        setSelectedIds(new Set(filteredProjects.map((p) => p.id)))
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedIds.size, filteredProjects, clearSelection])

  const handleConfirmBulkDelete = async () => {
    setIsBulkDeleting(true)
    const ids = Array.from(selectedIds)
    const results = await Promise.all(ids.map((id) => deleteProject(id, false)))
    const failures = results.filter((r) => !r.success)
    setIsBulkDeleting(false)
    setShowBulkDeleteDialog(false)
    clearSelection()

    if (failures.length === 0) {
      toast.success(t('projects.list.movedToTrashCount', { count: ids.length }))
    } else if (failures.length < ids.length) {
      toast.warning(
        t('projects.list.movedToTrashPartial', {
          moved: ids.length - failures.length,
          failed: failures.length,
        }),
        {
          description: failures[0]?.error,
        },
      )
    } else {
      toast.error(t('projects.list.deleteSelectedFailed'), { description: failures[0]?.error })
    }
  }

  const isEmpty = allProjects.length === 0
  const hasNoResults = !isEmpty && filteredProjects.length === 0
  const selectionCount = selectedIds.size

  return (
    <div className="space-y-6">
      {/* Search and Filters Bar */}
      {!isEmpty && (
        <div className="flex items-center gap-3">
          {/* Search */}
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder={t('projects.list.searchPlaceholder')}
              value={localSearchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="pl-9 pr-9"
            />
            {localSearchQuery && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                onClick={() => handleSearchChange('')}
              >
                <X className="w-3 h-3" />
              </Button>
            )}
          </div>

          {/* Resolution Filter */}
          <Select
            value={filterResolution || 'all'}
            onValueChange={(value) => setFilterResolution(value === 'all' ? undefined : value)}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder={t('projects.list.allResolutions')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('projects.list.allResolutions')}</SelectItem>
              {uniqueResolutions.map((res) => (
                <SelectItem key={res} value={res}>
                  {res}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* FPS Filter */}
          <Select
            value={filterFps?.toString() || 'all'}
            onValueChange={(value) => setFilterFps(value === 'all' ? undefined : Number(value))}
          >
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder={t('projects.list.allFps')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('projects.list.allFps')}</SelectItem>
              {uniqueFps.map((fps) => (
                <SelectItem key={fps} value={fps.toString()}>
                  {t('projects.list.fpsOption', { fps })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Sort Menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon">
                <ArrowUpDown className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>{t('projects.list.sortBy')}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setSortField('name')}>
                {t('projects.list.sortName')}{' '}
                {sortField === 'name' && `(${sortDirection === 'asc' ? '↑' : '↓'})`}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSortField('updatedAt')}>
                {t('projects.list.sortLastModified')}{' '}
                {sortField === 'updatedAt' && `(${sortDirection === 'asc' ? '↑' : '↓'})`}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSortField('createdAt')}>
                {t('projects.list.sortDateCreated')}{' '}
                {sortField === 'createdAt' && `(${sortDirection === 'asc' ? '↑' : '↓'})`}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSortField('resolution')}>
                {t('projects.list.sortResolution')}{' '}
                {sortField === 'resolution' && `(${sortDirection === 'asc' ? '↑' : '↓'})`}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={toggleSortDirection}>
                {sortDirection === 'asc'
                  ? t('projects.list.ascending')
                  : t('projects.list.descending')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Clear Filters */}
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={handleClearFilters}>
              <X className="w-4 h-4 mr-2" />
              {t('projects.list.clearFilters')}
            </Button>
          )}

          {/* Spacer */}
          <div className="flex-1" />

          {/* Selection controls */}
          {selectionCount > 0 && (
            <>
              <span className="text-sm text-muted-foreground whitespace-nowrap">
                {t('projects.list.selectedCount', { count: selectionCount })}
              </span>
              <Button variant="ghost" size="sm" onClick={clearSelection}>
                {t('projects.list.clearSelection')}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                className="gap-2"
                onClick={() => setShowBulkDeleteDialog(true)}
              >
                <Trash2 className="w-4 h-4" />
                {t('projects.list.deleteN', { count: selectionCount })}
              </Button>
            </>
          )}
        </div>
      )}

      {/* Empty State - No Projects */}
      {isEmpty && (
        <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
          <h2 className="text-3xl font-semibold text-foreground mb-2">
            {t('projects.list.welcomeTitle')}
          </h2>
          <p className="text-muted-foreground max-w-md mb-6">
            {t('projects.list.welcomeDescription')}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button size="lg" className="gap-2" asChild>
              <Link to="/projects/new">
                <Plus className="w-4 h-4" />
                {t('projects.list.createFirstProject')}
              </Link>
            </Button>
            {onImportProject && (
              <Button variant="outline" size="lg" className="gap-2" onClick={onImportProject}>
                <Upload className="w-4 h-4" />
                {t('projects.list.importExistingProject')}
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Empty State - No Search Results */}
      {hasNoResults && (
        <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
          <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mb-4">
            <Search className="w-8 h-8 text-muted-foreground" />
          </div>
          <h3 className="text-xl font-semibold text-foreground mb-2">
            {t('projects.list.noResultsTitle')}
          </h3>
          <p className="text-muted-foreground max-w-md mb-6">
            {t('projects.list.noResultsDescription')}
          </p>
          <Button variant="outline" onClick={handleClearFilters}>
            {t('projects.list.clearFilters')}
          </Button>
        </div>
      )}

      {/* Project Grid */}
      {!isEmpty && !hasNoResults && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-muted-foreground">
              {filteredProjects.length === allProjects.length
                ? t('projects.list.projectCount', { count: allProjects.length })
                : t('projects.list.projectCountFiltered', {
                    shown: filteredProjects.length,
                    total: allProjects.length,
                  })}
            </p>
          </div>

          <div ref={containerRef} className="relative -mx-3 px-3 py-2 min-h-[200px]">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filteredProjects.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  onEdit={onEditProject}
                  isSelected={selectedIds.has(project.id)}
                  onCardClick={handleCardClick}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Viewport-fixed marquee overlay */}
      {marquee && (
        <div
          className="fixed pointer-events-none border border-primary bg-primary/10 rounded-sm z-40"
          style={{
            left: marquee.x,
            top: marquee.y,
            width: marquee.width,
            height: marquee.height,
          }}
        />
      )}

      {/* Bulk delete confirm */}
      <AlertDialog open={showBulkDeleteDialog} onOpenChange={setShowBulkDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              {t('projects.list.bulkDeleteTitle', { count: selectionCount })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('projects.list.bulkDeleteDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isBulkDeleting}>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmBulkDelete}
              disabled={isBulkDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isBulkDeleting
                ? t('common.deleting')
                : t('projects.list.deleteN', { count: selectionCount })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
