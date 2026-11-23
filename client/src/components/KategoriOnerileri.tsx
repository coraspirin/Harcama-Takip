import { Sparkles } from 'lucide-react';
import type { CategorySuggestion } from '../types/index.ts';

/** Aciklama alaninin altinda en fazla 3 onerilen kategori chip'i. */
export function KategoriOnerileri({
  suggestions,
  selectedId,
  autoSelected,
  onChoose,
}: {
  suggestions: CategorySuggestion[];
  selectedId: number | null;
  autoSelected: boolean;
  onChoose: (categoryId: number) => void;
}) {
  if (suggestions.length === 0 && !autoSelected) return null;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {suggestions.map((s) => {
        const active = s.categoryId === selectedId;
        return (
          <button
            key={s.categoryId}
            type="button"
            aria-pressed={active}
            onClick={() => onChoose(s.categoryId)}
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition-colors ${
              active
                ? 'bg-brand-50 text-brand-700 ring-brand-300'
                : 'bg-white text-slate-600 ring-slate-300 hover:bg-slate-50'
            }`}
          >
            <Sparkles className="h-3 w-3" aria-hidden />
            Oneri: {s.categoryName}
          </button>
        );
      })}
      {autoSelected && <span className="text-xs text-slate-500">otomatik secildi</span>}
    </div>
  );
}
