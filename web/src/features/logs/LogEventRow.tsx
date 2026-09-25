import { Link } from 'react-router';
import { ChevronRight } from 'lucide-react';
import { LOG_EVENT_TYPES, UPLOAD_GONE_EVENT_TYPES, type LogEvent, type LogLevel, type LogSource } from '@label-extractor/shared';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { formatDateTimeWithSeconds, formatTimeOfDay } from '@/lib/format';
import { TONE_CLASSES, type Tone } from '@/lib/tone';
import { cn } from '@/lib/utils';
import { uploadPath } from '@/routes';

/** Only warnings and errors get a badge, so they stand out in a column of everyday events. */
const LEVEL_BADGE: Record<LogLevel, { label: string; tone: Tone } | null> = {
  info: null,
  warn: { label: 'Warning', tone: 'warning' },
  error: { label: 'Error', tone: 'danger' },
};

const SOURCE_LABEL: Record<LogSource, string> = { api: 'API', worker: 'Worker' };

/**
 * One event: its time, level, message, then what kind of event it was, which process wrote it and
 * a link to its upload. The structured details are one click away, for the codes and numbers the
 * sentence leaves out.
 */
export function LogEventRow({ event }: { event: LogEvent }) {
  const badge = LEVEL_BADGE[event.level];
  // Rejected and discarded uploads are deleted, so there's nothing to open.
  const uploadId = event.uploadId !== null && !UPLOAD_GONE_EVENT_TYPES.includes(event.type) ? event.uploadId : null;
  const hasDetails = Object.keys(event.data).length > 0;

  return (
    <li className="border-b border-border/70 last:border-b-0">
      <Collapsible className="group/event grid grid-cols-[4.5rem_4.75rem_minmax(0,1fr)] items-baseline gap-x-3 px-5 py-2.5">
        <time
          dateTime={event.occurredAt}
          title={formatDateTimeWithSeconds(event.occurredAt)}
          className="text-sm text-muted-foreground tabular-nums"
        >
          {formatTimeOfDay(event.occurredAt)}
        </time>
        <span>
          {badge && (
            <Badge variant="outline" className={cn('rounded-full', TONE_CLASSES[badge.tone])}>
              {badge.label}
            </Badge>
          )}
        </span>
        <div className="grid min-w-0 gap-0.5">
          <p className="text-sm break-words text-foreground">{event.message}</p>
          <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            <span>{LOG_EVENT_TYPES[event.type].label}</span>
            <Dot />
            <span>{SOURCE_LABEL[event.source]}</span>
            {uploadId && (
              <>
                <Dot />
                <Link to={uploadPath(uploadId)} className="font-medium text-brand hover:underline">
                  View upload
                </Link>
              </>
            )}
            {hasDetails && (
              <>
                <Dot />
                <CollapsibleTrigger className="inline-flex items-center gap-0.5 rounded-sm hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none">
                  {/* Points right when collapsed, down when open. */}
                  <ChevronRight className="size-3 transition-transform group-data-[state=open]/event:rotate-90" aria-hidden />
                  Details
                </CollapsibleTrigger>
              </>
            )}
          </p>
          <CollapsibleContent>
            <pre className="mt-1.5 rounded-md border bg-muted/40 px-3 py-2 text-xs leading-relaxed break-words whitespace-pre-wrap">
              {JSON.stringify(event.data, null, 2)}
            </pre>
          </CollapsibleContent>
        </div>
      </Collapsible>
    </li>
  );
}

function Dot() {
  return <span aria-hidden>·</span>;
}
