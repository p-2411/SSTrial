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
 * The log's filters: what to show (one menu), and the upload it's narrowed to, if any (a chip,
 * removable).
 */
export function LogFilterBar({ filters, onChange, uploadName }: LogFilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ShowMenu filters={filters} onChange={onChange} />
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
  'process.started': 'System',
} satisfies Record<LogEventType, string>;

/** The menu's sections of event types, in shared's order. */
const TYPE_MENU: Array<{ heading: string; types: LogEventType[] }> = [];
for (const type of LOG_EVENT_TYPE_IDS) {
  const heading = TYPE_GROUP[type];
  const section = TYPE_MENU.find((candidate) => candidate.heading === heading);
  if (section) section.types.push(type);
  else TYPE_MENU.push({ heading, types: [type] });
}

/**
 * What to show: everything, a minimum level, or one type of event. One menu rather than two
 * filters, because each type of event always has the same level ("Errors only" is just the failed
 * and abandoned extractions), so the two would only ever narrow the same thing. Choosing one
 * clears the other.
 */
function ShowMenu({ filters, onChange }: { filters: LogFilters; onChange: (changes: Partial<LogFilters>) => void }) {
  const select = (value: string) => {
    if (isLogEventType(value)) return onChange({ type: value, level: 'all' });
    const level = LOG_LEVEL_FILTER_IDS.find((id) => id === value);
    if (level) onChange({ level, type: null });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-9">
          <ListFilter data-icon="inline-start" aria-hidden />
          {/* The space keeps the accessible name "Show everything" rather than "Showeverything". */}
          <span className="font-normal">Show</span> {midSentence(filters.type ? LOG_EVENT_TYPES[filters.type] : LOG_LEVEL_FILTERS[filters.level])}
          <ChevronDown data-icon="inline-end" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuRadioGroup value={filters.type ?? filters.level} onValueChange={select}>
          {LOG_LEVEL_FILTER_IDS.map((id) => (
            <DropdownMenuRadioItem key={id} value={id}>
              {LOG_LEVEL_FILTERS[id]}
            </DropdownMenuRadioItem>
          ))}
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

/** A label as it reads after "Show": "Errors only" → "errors only", but "AI requests paused" stays. */
function midSentence(label: string): string {
  const firstWord = label.split(' ')[0]!;
  return firstWord === firstWord.toUpperCase() ? label : label.charAt(0).toLowerCase() + label.slice(1);
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
