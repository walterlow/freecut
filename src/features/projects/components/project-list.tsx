import { useState, useMemo } from 'react';
import { Search, ArrowUpDown, X } from 'lucide-react';
import { FreeCutLogo } from '@/components/brand/freecut-logo';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ProjectCard } from './project-card';
import {
  useFilteredProjects,
  useSearchQuery,
  useSortField,
  useSortDirection,
  useFilterResolution,
  useFilterFps,
  useHasActiveFilters,
} from '../hooks/use-project-selectors';
import { useProjectFilters } from '../hooks/use-project-actions';
import { getUniqueResolutions, getUniqueFps } from '../utils/project-helpers';
import { useProjects } from '../hooks/use-project-selectors';
import type { Project } from '@/types/project';

export interface ProjectListProps {
  onEditProject?: (project: Project) => void;
}

export function ProjectList({ onEditProject }: ProjectListProps) {
  const [localSearchQuery, setLocalSearchQuery] = useState('');

  // Selectors
  const allProjects = useProjects();
  const filteredProjects = useFilteredProjects();
  const searchQuery = useSearchQuery();
  const sortField = useSortField();
  const sortDirection = useSortDirection();
  const filterResolution = useFilterResolution();
  const filterFps = useFilterFps();
  const hasActiveFilters = useHasActiveFilters();

  // Actions
  const {
    setSearchQuery,
    setSortField,
    setSortDirection,
    setFilterResolution,
    setFilterFps,
    clearFilters,
  } = useProjectFilters();

  // Get unique values for filters
  const uniqueResolutions = useMemo(() => getUniqueResolutions(allProjects), [allProjects]);
  const uniqueFps = useMemo(() => getUniqueFps(allProjects), [allProjects]);

  // Debounced search handler
  const handleSearchChange = (value: string) => {
    setLocalSearchQuery(value);
    // Simple debounce with setTimeout
    const timeoutId = setTimeout(() => {
      setSearchQuery(value);
    }, 300);
    return () => clearTimeout(timeoutId);
  };

  const handleClearFilters = () => {
    setLocalSearchQuery('');
    clearFilters();
  };

  const toggleSortDirection = () => {
    setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
  };

  const isEmpty = allProjects.length === 0;
  const hasNoResults = !isEmpty && filteredProjects.length === 0;

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
              placeholder="Search projects..."
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
              <SelectValue placeholder="All Resolutions" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Resolutions</SelectItem>
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
              <SelectValue placeholder="All FPS" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All FPS</SelectItem>
              {uniqueFps.map((fps) => (
                <SelectItem key={fps} value={fps.toString()}>
                  {fps} fps
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
              <DropdownMenuLabel>Sort by</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setSortField('name')}>
                Name {sortField === 'name' && `(${sortDirection === 'asc' ? '↑' : '↓'})`}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSortField('updatedAt')}>
                Last Modified{' '}
                {sortField === 'updatedAt' && `(${sortDirection === 'asc' ? '↑' : '↓'})`}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSortField('createdAt')}>
                Date Created {sortField === 'createdAt' && `(${sortDirection === 'asc' ? '↑' : '↓'})`}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSortField('resolution')}>
                Resolution {sortField === 'resolution' && `(${sortDirection === 'asc' ? '↑' : '↓'})`}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={toggleSortDirection}>
                {sortDirection === 'asc' ? 'Ascending' : 'Descending'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Clear Filters */}
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={handleClearFilters}>
              <X className="w-4 h-4 mr-2" />
              Clear Filters
            </Button>
          )}
        </div>
      )}

      {/* Empty State - No Projects */}
      {isEmpty && (
        <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
          <h2 className="text-3xl font-semibold text-foreground mb-2">Welcome to FreeCut</h2>
          <p className="text-muted-foreground max-w-md mb-6">
            Get started by creating your first video project. Choose your resolution, frame rate, and
            start editing!
          </p>
        </div>
      )}

      {/* Empty State - No Search Results */}
      {hasNoResults && (
        <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
          <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mb-4">
            <Search className="w-8 h-8 text-muted-foreground" />
          </div>
          <h3 className="text-xl font-semibold text-foreground mb-2">No projects found</h3>
          <p className="text-muted-foreground max-w-md mb-6">
            We couldn't find any projects matching your search criteria. Try adjusting your filters or
            search terms.
          </p>
          <Button variant="outline" onClick={handleClearFilters}>
            Clear Filters
          </Button>
        </div>
      )}

      {/* Project Grid */}
      {!isEmpty && !hasNoResults && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-muted-foreground">
              {filteredProjects.length === allProjects.length
                ? `${allProjects.length} project${allProjects.length === 1 ? '' : 's'}`
                : `${filteredProjects.length} of ${allProjects.length} project${allProjects.length === 1 ? '' : 's'}`}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredProjects.map((project) => (
              <ProjectCard key={project.id} project={project} onEdit={onEditProject} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
