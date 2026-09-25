import type { LucideIcon } from 'lucide-react';
import { CheckCircle2, Clock, Loader2, XCircle } from 'lucide-react';
import type { UploadStatus } from '@label-extractor/shared';
import { Badge } from '@/components/ui/badge';
import { TONE_CLASSES } from '@/lib/tone';
import { cn } from '@/lib/utils';

const STATUS: Record<UploadStatus, { label: string; icon: LucideIcon; className: string; spin?: boolean }> = {
  uploading: { label: 'Uploading', icon: Loader2, spin: true, className: 'border-border bg-card text-muted-foreground' },
  queued: { label: 'Queued', icon: Clock, className: 'border-border bg-card text-muted-foreground' },
  processing: { label: 'Processing', icon: Loader2, spin: true, className: 'border-brand/25 bg-brand-soft text-brand' },
  completed: { label: 'Completed', icon: CheckCircle2, className: TONE_CLASSES.success },
  failed: { label: 'Failed', icon: XCircle, className: TONE_CLASSES.danger },
};

/** Status as a rounded pill: icon + word, never colour alone (SupplyScope's pill style). */
export function StatusPill({ status, className }: { status: UploadStatus; className?: string }) {
  const { label, icon: Icon, className: tone, spin } = STATUS[status];
  return (
    <Badge variant="outline" className={cn('h-6 gap-1 rounded-full px-2.5 font-medium', tone, className)}>
      <Icon aria-hidden className={cn(spin && 'animate-spin motion-reduce:animate-none')} />
      {label}
    </Badge>
  );
}
