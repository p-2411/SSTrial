import { toast } from 'sonner';
import { productCount } from './format';

interface BatchWording {
  /** What happened to those it acted on, after the count: "deleted". */
  done: string;
  /** What happened to the rest: "not deleted". */
  skipped: string;
  /** Why the rest were skipped. */
  why: string;
}

/**
 * How an action on several products went, in a toast each way: how many it acted on, and how
 * many the server skipped, and why. Either is left out when there are none.
 */
export function toastBatchResult(done: number, asked: number, wording: BatchWording): void {
  if (done > 0) toast.success(`${productCount(done)} ${wording.done}`);
  const skipped = asked - done;
  if (skipped > 0) toast.warning(`${productCount(skipped)} ${wording.skipped}`, { description: wording.why });
}
