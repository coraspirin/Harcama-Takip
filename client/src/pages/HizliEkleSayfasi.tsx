import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Dashboard from './Dashboard.tsx';
import { HizliEkle } from '../components/HizliEkle.tsx';

/**
 * /hizli-ekle (PWA kisayolu): Ozet ekrani acilir, hizli ekleme modali otomatik
 * acik gelir; kapaninca ana sayfaya donulur.
 */
export default function HizliEkleSayfasi() {
  const navigate = useNavigate();
  const close = useCallback(() => navigate('/', { replace: true }), [navigate]);

  return (
    <>
      <Dashboard />
      <HizliEkle open onClose={close} />
    </>
  );
}
