import { useCallback, useEffect, useRef, useState } from 'react';
import { suggestCategory } from '../services/finance.ts';
import type { CategorySuggestion } from '../types/index.ts';

export const SUGGEST_DEBOUNCE_MS = 300;
export const MIN_DESCRIPTION_LENGTH = 2;
export const AUTO_SELECT_MIN_CONFIDENCE = 0.8;
export const AUTO_SELECT_MIN_MATCHES = 3;

type Options = {
  description: string;
  type: 'income' | 'expense';
  /** Formda su an secili kategori */
  categoryId: number | null;
  /** Kategoriyi forma yazar (otomatik secim ve chip tiklamasi) */
  onSelect: (categoryId: number) => void;
  /** Yalnizca bu kategoriler onerilir (tur uyusmayan/arsivli kategori secilemez) */
  validCategoryIds: ReadonlySet<number>;
  /** Kategori yokken otomatik on secim yapilabilsin mi (duzenlemede false) */
  allowAutoSelect: boolean;
};

/**
 * Aciklamaya gore kategori onerisi (300 ms debounce).
 *
 * - Eski isteklerin yaniti yenisini ezmez (efekt basina iptal bayragi).
 * - Hata olursa oneri sessizce bos kalir; kullaniciya hata gosterilmez.
 * - Otomatik secim: kategori bos, kullanici kategoriyi hic elle degistirmemis,
 *   en iyi onerinin guveni >= 0.8 ve eslesme sayisi >= 3 ise yapilir. Mevcut
 *   (secili) kategori ASLA otomatik degistirilmez.
 */
export function useCategorySuggestion({
  description,
  type,
  categoryId,
  onSelect,
  validCategoryIds,
  allowAutoSelect,
}: Options) {
  const [fetched, setFetched] = useState<{ key: string; items: CategorySuggestion[] } | null>(null);
  const [autoSelectedId, setAutoSelectedId] = useState<number | null>(null);
  const manual = useRef(false);

  const trimmed = description.trim();
  const key = `${type}|${trimmed}`;

  useEffect(() => {
    if (trimmed.length < MIN_DESCRIPTION_LENGTH) return;

    // Efekt her yeniden calistiginda onceki istek iptal sayilir: eski yanit yenisini ezmez
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const items = await suggestCategory(trimmed, type);
          if (!cancelled) setFetched({ key, items });
        } catch {
          // Oneri istege bagli: hata sessizce yutulur
          if (!cancelled) setFetched({ key, items: [] });
        }
      })();
    }, SUGGEST_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      cancelled = true;
    };
  }, [trimmed, type, key]);

  // Yanit yalnizca su anki aciklama + tur icin gecerlidir; aksi halde bayat sayilir.
  const current =
    trimmed.length >= MIN_DESCRIPTION_LENGTH && fetched?.key === key ? fetched.items : [];
  const suggestions = current.filter((s) => validCategoryIds.has(s.categoryId)).slice(0, 3);

  const top = suggestions[0];
  const autoCandidate =
    top && top.confidence >= AUTO_SELECT_MIN_CONFIDENCE && top.matchCount >= AUTO_SELECT_MIN_MATCHES
      ? top.categoryId
      : null;

  useEffect(() => {
    if (!allowAutoSelect || manual.current || categoryId !== null || autoCandidate === null) return;
    onSelect(autoCandidate);
    setAutoSelectedId(autoCandidate);
  }, [allowAutoSelect, categoryId, autoCandidate, onSelect]);

  /** Kullanici bir oneri chip'ine tikladi */
  const choose = useCallback(
    (id: number) => {
      manual.current = true;
      setAutoSelectedId(null);
      onSelect(id);
    },
    [onSelect],
  );

  /** Kullanici kategoriyi baska bir yoldan (liste, son kategori chip'i) elle degistirdi */
  const markManual = useCallback(() => {
    manual.current = true;
    setAutoSelectedId(null);
  }, []);

  /** Form yeniden acildi/sifirlandi */
  const reset = useCallback(() => {
    manual.current = false;
    setFetched(null);
    setAutoSelectedId(null);
  }, []);

  return {
    suggestions,
    autoSelected: autoSelectedId !== null && autoSelectedId === categoryId,
    choose,
    markManual,
    reset,
  };
}
