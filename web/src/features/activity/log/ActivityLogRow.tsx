import { Link } from 'react-router';
import { ArrowUpRight } from 'lucide-react';
import { UPLOAD_GONE_EVENT_TYPES, type LogEvent, type LogLevel } from '@label-extractor/shared';
import { Badge } from '@/components/ui/badge';
import { formatTimeOfDay } from '@/lib/format';
import { LEVEL_TONE, TONE_CLASSES } from '@/lib/tone';
import { cn } from '@/lib/utils';
import { uploadPath } from '@/routes';
import { EVENT_ACTION_CLASS } from '../EventDetails';
import { EventRow } from '../EventRow';

/** Only warnings and errors get a badge (in their LEVEL_TONE), so they stand out in a column of everyday events. */
const LEVEL_BADGE: Record<LogLevel, string | null> = {
  info: null,
  warn: 'Warning',
  error: 'Error',
};

/** Details opened from the activity log are fetched through the log's own endpoint. */
const FROM_THE_LOG = {};

/**
 * One event, written for the business rather than engineers: its time, level and message (which
 * already says what happened), then a link to its upload and its details (see EventRow). The
 * actions have fixed columns, so they line up down the log.
 */
export function ActivityLogRow({ event }: { event: LogEvent }) {
  const badge = LEVEL_BADGE[event.level];
  const tone = LEVEL_TONE[event.level];
  // Rejected and discarded uploads are deleted, so there's nothing to open.
  const uploadId = event.uploadId !== null && !UPLOAD_GONE_EVENT_TYPES.includes(event.type) ? event.uploadId : null;

  return (
    <li className="border-b border-border/70">
      <EventRow
        event={event}
        source={FROM_THE_LOG}
        time={formatTimeOfDay(event.occurredAt)}
        className="grid-cols-[4.5rem_4.75rem_minmax(0,1fr)_5.5rem_3.75rem] gap-x-3 px-5 py-2.5"
        timeClassName="text-sm"
        detailsClassName="col-span-3 col-start-3"
        actions={[
          uploadId && (
            <Link to={uploadPath(uploadId)} className={EVENT_ACTION_CLASS}>
              <ArrowUpRight aria-hidden />
              <span>View upload</span>
            </Link>
          ),
        ]}
      >
        <span>
          {badge && tone && (
            <Badge variant="outline" className={cn('rounded-full', TONE_CLASSES[tone])}>
              {badge}
            </Badge>
          )}
        </span>
        <p className="min-w-0 text-sm break-words text-foreground">{event.message}</p>
      </EventRow>
    </li>
  );
}
