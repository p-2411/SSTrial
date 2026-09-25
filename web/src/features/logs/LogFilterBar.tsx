import { Fragment } from 'react';
import { Link } from 'react-router';
import { ChevronDown, ListFilter, X } from 'lucide-react';
import {
  isLogEventType,
  LOG_EVENT_TYPE_IDS,
  LOG_EVENT_TYPES,
  LOG_LEVEL_FILTER_IDS,
  LOG_LEVEL_FILTERS,
  type LogEventType,
} from '@label-extractor/shared';
import type { LogFilters } from '@/api/logs';
import { SegmentedTabsList, SegmentedTabsTrigger } from '@/components/SegmentedTabs';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { uploadPath } from '@/routes';

interface LogFilterBarProps {
  filters: LogFilters;
  onChange: (changes: Partial<LogFilters>) => void;
  /** The file name of the upload the log is narrowed to, once its events have loaded. */
  uploadName: string | null;
}

/**
 * The log's filters: minimum level (segmented tabs), type of event (a menu), and the upload it's
 * narrowed to, if any (a chip, removable). Must be rendered inside the page's <Tabs>, which holds
 * the level.
 */
export function LogFilterBar({ filters, onChange, uploadName }: LogFilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <SegmentedTabsList aria-label="Filter events by level">
        {LOG_LEVEL_FILTER_IDS.map((id) => (
          <SegmentedTabsTrigger key={id} value={id}>
            {LOG_LEVEL_FILTERS[id]}
          </SegmentedTabsTrigger>
        ))}
      </SegmentedTabsList>
      <EventTypeMenu value={filters.type} onChange={(type) => onChange({ type })} />
      {filters.upload && <UploadChip id={filters.upload} name={uploadName} onClear={() => onChange({ upload: null })} />}
    </div>
  );
}

/** Which heading each type sits under in the menu. Keyed by type, so a new one needs a place here. */
const TYPE_GROUP = {
  'upload.created': 'Uploads',
  'upload.duplicate': 'Uploads',
  'upload.queued': 'Uploads',
  'upload.rejected': 'Uploads',
  'upload.discarded': 'Uploads',
  'upload.retry_requested': 'Uploads',
  'extraction.started': 'Extraction',
  'extraction.completed': 'Extraction',
  'extraction.retry_scheduled': 'Extraction',
  'extraction.failed': 'Extraction',
  'extraction.abandoned': 'Extraction',
  'ratelimit.paused': 'Extraction',
  'alert.opened': 'System',
  'alert.resolved': 'System',
  'process.started': 'System',
} satisfies Record<LogEventType, string>;

/** The menu's sections, in shared's order. */
const TYPE_MENU: Array<{ heading: string; types: LogEventType[] }> = [];
for (const type of LOG_EVENT_TYPE_IDS) {
  const heading = TYPE_GROUP[type];
  const section = TYPE_MENU.find((candidate) => candidate.heading === heading);
  if (section) section.types.push(type);
  else TYPE_MENU.push({ heading, types: [type] });
}

/** The radio value for "no type filter": the menu's values are strings. */
const ALL_TYPES = 'all';

function EventTypeMenu({ value, onChange }: { value: LogEventType | null; onChange: (type: LogEventType | null) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-9">
          <ListFilter data-icon="inline-start" aria-hidden />
          {value ? LOG_EVENT_TYPES[value] : 'All event types'}
          <ChevronDown data-icon="inline-end" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuRadioGroup
          value={value ?? ALL_TYPES}
          onValueChange={(next) => onChange(isLogEventType(next) ? next : null)}
        >
          <DropdownMenuRadioItem value={ALL_TYPES}>All event types</DropdownMenuRadioItem>
          {TYPE_MENU.map(({ heading, types }) => (
            <Fragment key={heading}>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{heading}</DropdownMenuLabel>
              {types.map((type) => (
                <DropdownMenuRadioItem key={type} value={type}>
                  {LOG_EVENT_TYPES[type]}
                </DropdownMenuRadioItem>
              ))}
            </Fragment>
          ))}
        </DropdownMenuRadioGroup>
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
