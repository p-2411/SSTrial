import type { ProductFilter } from '@/api/uploads';
import { DayRangeMenu } from '@/components/DayRangeMenu';
import { SearchInput } from '@/components/SearchInput';

/** Narrowing Products: words in a product's name, brand or file name, and when it was added. */
export function ProductFilterBar({ filter, onChange }: { filter: ProductFilter; onChange: (changes: Partial<ProductFilter>) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border/70 px-4 py-3">
      <SearchInput
        value={filter.search}
        onSearch={(search) => onChange({ search })}
        label="Search products"
        placeholder="Search by product, brand or file"
      />
      <DayRangeMenu label="Added" range={filter} onChange={({ from, to }) => onChange({ from, to })} />
    </div>
  );
}
