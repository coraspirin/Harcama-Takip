import { useEffect, useRef } from 'react';

/**
 * Basit global "islem eklendi/degisti" olayi.
 *
 * Hizli ekleme modali herhangi bir sayfanin ustunde acilabilir; kayittan sonra
 * arkadaki sayfanin (Ozet, Islemler) listesini yenilemesi icin ek bir veri
 * katmani kutuphanesi yerine kucuk bir EventTarget kullanilir.
 */
const bus = new EventTarget();
const EVENT_NAME = 'transactions-changed';

export function notifyTransactionsChanged(): void {
  bus.dispatchEvent(new Event(EVENT_NAME));
}

/** Olay geldiginde `handler` cagrilir; handler degisse de yeniden abone olunmaz. */
export function useOnTransactionsChanged(handler: () => void): void {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  }, [handler]);

  useEffect(() => {
    const listener = () => ref.current();
    bus.addEventListener(EVENT_NAME, listener);
    return () => bus.removeEventListener(EVENT_NAME, listener);
  }, []);
}
