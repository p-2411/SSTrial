import { Fragment, useEffect, useRef, useState } from 'react';
import { Link, type NavigateOptions } from 'react-router';
import { ChevronDown, ListFilter, Search, X } from 'lucide-react';
import { LOG_EVENT_TYPES, type LogEventType } from '@label-extractor/shared';
import type { LogFilters } from '@/api/logs';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { uploadPath } from '@/routes';
import { describeFilter, inCatalogueOrder, MAX_SEARCH_LENGTH, sameTypes, SHORTCUTS, TYPE_MENU } from './logFilters';

/** How long typing has to pause before the log is searched: long enough not to search every letter. */
export const SEARCH_DELAY_MS = 300;

interface LogFilterBarProps {
  filters: LogFilters;
  onChange: (changes: Partial<LogFilters>, options?: NavigateOptions) => void;
  /** The file name of the upload the log is narrowed to, once its events have loaded. */
  uploadName: string | null;
}

/**
 * The log's filters: words to search for, which types of event to show (one menu), and the upload
 * it's narrowed to, if any (a chip, removable).
 */
export function LogFilterBar({ filters, onChange, uploadName }: LogFilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Each search replaces the last in the history: Back shouldn't step through every word typed. */}
      <SearchBox value={filters.search} onSearch={(search) => onChange({ search }, { replace: true })} />
      <ShowMenu types={filters.types} onChange={(types) => onChange({ types })} />
      {filters.upload && <UploadChip id={filters.upload} name={uploadName} onClear={() => onChange({ upload: null })} />}
    </div>
  );
}

/**
 * Searches the events' messages for what's typed, once typing pauses (or at once, on Enter). Follows
 * the URL too, so Back, or "Show every event", updates what it shows.
 */
function SearchBox({ value, onSearch }: { value: string; onSearch: (search: string) => void }) {
  const [text, setText] = useState(value);
  const [searched, setSearched] = useState(value);
  // The search changed without typing here: show it. (Not when it's just this text, searched.)
  if (value !== searched) {
    setSearched(value);
    if (value !== text.trim()) setText(value);
  }

  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const search = (next: string, delay: number) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (next.trim() !== value) onSearch(next.trim());
    }, delay);
  };

  return (
    <div className="relative w-72">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input
        type="search"
        aria-label="Search the activity log"
        placeholder="Search by file, person or message"
        maxLength={MAX_SEARCH_LENGTH}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          search(event.target.value, SEARCH_DELAY_MS);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') search(text, 0);
        }}
        className="h-9 bg-card pl-8 shadow-xs"
      />
    </div>
  );
}

/**
 * Which types of event to show: any number of them, ticked in the menu (which stays open while you
 * tick), or a shortcut at the top that picks a whole set at once.
 */
function ShowMenu({ types, onChange }: { types: LogEventType[]; onChange: (types: LogEventType[]) => void }) {
  const toggle = (type: LogEventType, checked: boolean) =>
    onChange(inCatalogueOrder(checked ? [...types, type] : types.filter((selected) => selected !== type)));

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-9">
          <ListFilter data-icon="inline-start" aria-hidden />
          {/* The space keeps the accessible name "Show everything" rather than "Showeverything". */}
          <span className="font-normal">Show</span> {describeFilter(types)}
          <ChevronDown data-icon="inline-end" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {SHORTCUTS.map((shortcut) => (
          <DropdownMenuCheckboxItem
            key={shortcut.label}
            checked={sameTypes(shortcut.types, types)}
            onCheckedChange={() => onChange(shortcut.types)}
          >
            {shortcut.label}
          </DropdownMenuCheckboxItem>
        ))}
        {TYPE_MENU.map(({ heading, types: group }) => (
          <Fragment key={heading}>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{heading}</DropdownMenuLabel>
            {group.map((type) => (
              <DropdownMenuCheckboxItem
                key={type}
                checked={types.includes(type)}
                onCheckedChange={(checked) => toggle(type, checked)}
                // Keep the menu open, so several types can be ticked in one go.
                onSelect={(event) => event.preventDefault()}
              >
                {LOG_EVENT_TYPES[type].label}
              </DropdownMenuCheckboxItem>
            ))}
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UploadChip({ id, name, onClear }: { id: string; name: string | null; onClear: () => void }) {
  return (
    <span className="inline-flex h-9 items-center gap-1.5 rounded-md border bg-card pr-1 pl-3 text-sm shadow-xs">
      <span className="text-muted-foreground">Upload</span>
      <Link to={uploadPath(id)} className="max-w-60 truncate font-medium hover:underline" title={name ?? undefined}>
        {name ?? 'Selected upload'}
      </Link>
      <Button variant="ghost" size="icon" className="size-7" onClick={onClear} aria-label="Show events for every upload">
        <X aria-hidden />
      </Button>
    </span>
  );
}
