import { useState } from 'react';
import type { LabelExtraction } from '@label-extractor/shared';
import { Button } from '../../components/Button.tsx';
import styles from './JsonDisclosure.module.css';

/** The raw structured result, for people wiring it into other systems. Collapsed by default. */
export function JsonDisclosure({ data }: { data: LabelExtraction }) {
  const json = JSON.stringify(data, null, 2);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked (permissions, insecure context); the JSON is still selectable.
    }
  }

  return (
    <details className={styles.details}>
      <summary className={styles.summary}>Structured data (JSON)</summary>
      <div className={styles.body}>
        <Button size="sm" onClick={() => void copy()}>
          {copied ? 'Copied' : 'Copy JSON'}
        </Button>
        <pre className={styles.code}>{json}</pre>
      </div>
    </details>
  );
}
