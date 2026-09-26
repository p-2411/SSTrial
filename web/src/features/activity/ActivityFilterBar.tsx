import { Fragment, type ReactNode } from 'react';
import { ChevronDown, ListFilter } from 'lucide-react';
import { LOG_EVENT_TYPES, type LogEventType } from '@label-extractor/shared';
import type { ActivityFilters } from '@/api/logs';
import { DayRangeMenu } from '@/components/DayRangeMenu';
import { SearchInput } from '@/components/SearchInput';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { describeFilter, inCatalogueOrder, sameTypes, typeMenu, typeShortcuts } from './eventTypes';

interface ActivityFilterBarProps {
  filters: ActivityFilters;
  /** `replace`: a search being typed, which shouldn't add a step to the browser's history per pause. */
  onChange: (changes: Partial<ActivityFilters>, options?: { replace?: boolean }) => void;
  /** The types of event it can show. */
  types: readonly LogEventType[];
  /** The search box's accessible name and placeholder. */
  searchLabel: string;
  searchPlaceholder: string;
  className?: string;
  /** Sizes the search box, which is otherwise a fixed width. */
  searchClassName?: string;
  /** More filters, after these (the activity log's upload, say). */
  children?: ReactNode;
}

/**
 * Narrowing a list of events: words to search for, which types of event to show (one menu), and
 * which days. The activity log and each product's history both have one.
 */
export function ActivityFilterBar({
  filters,
  onChange,
  types,
  searchLabel,
  searchPlaceholder,
  className,
  searchClassName,
  children,
}: ActivityFilterBarProps) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <SearchInput
        value={filters.search}
        onSearch={(search) => onChange({ search }, { replace: true })}
        label={searchLabel}
        placeholder={searchPlaceholder}
        className={cn('max-w-full', searchClassName)}
      />
      <TypeMenu selected={filters.types} offered={types} onChange={(selected) => onChange({ types: selected })} />
      <DayRangeMenu range={filters} onChange={({ from, to }) => onChange({ from, to })} />
      {children}
    </div>
  );
}

/**
 * Which types of event to show: any number of them, ticked in the menu (which stays open while you
 * tick), or a shortcut at the top that picks a whole set at once.
 */
function TypeMenu({ selected, offered, onChange }: { selected: LogEventType[]; offered: readonly LogEventType[]; onChange: (types: LogEventType[]) => void }) {
  const toggle = (type: LogEventType, checked: boolean) =>
    onChange(inCatalogueOrder(checked ? [...selected, type] : selected.filter((chosen) => chosen !== type)));

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-9">
          <ListFilter data-icon="inline-start" aria-hidden />
          {/* The space keeps the accessible name "Show everything" rather than "Showeverything". */}
          <span className="font-normal">Show</span> {describeFilter(selected, offered)}
          <ChevronDown data-icon="inline-end" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      {/* Kept clear of the window's edges; the list scrolls inside a padded box of its own, so its
          scrollbar stays within the menu's rounded corners. */}
      <DropdownMenuContent align="start" collisionPadding={16} className="flex w-64 flex-col overflow-hidden px-0 py-1.5">
        <div className="min-h-0 flex-1 overflow-y-auto px-1">
          {typeShortcuts(offered).map((shortcut) => (
            <DropdownMenuCheckboxItem
              key={shortcut.label}
              checked={sameTypes(shortcut.types, selected)}
              onCheckedChange={() => onChange(shortcut.types)}
            >
              {shortcut.label}
            </DropdownMenuCheckboxItem>
          ))}
          {typeMenu(offered).map(({ heading, types: group }) => (
            <Fragment key={heading}>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{heading}</DropdownMenuLabel>
              {group.map((type) => (
                <DropdownMenuCheckboxItem
                  key={type}
                  checked={selected.includes(type)}
                  onCheckedChange={(checked) => toggle(type, checked)}
                  // Keep the menu open, so several types can be ticked in one go.
                  onSelect={(event) => event.preventDefault()}
                >
                  {LOG_EVENT_TYPES[type].label}
                </DropdownMenuCheckboxItem>
              ))}
            </Fragment>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
