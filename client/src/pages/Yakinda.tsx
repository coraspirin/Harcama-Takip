import { Hammer } from 'lucide-react';
import { PageHeader, Card, EmptyState } from '../components/ui/Card.tsx';

/**
 * Henuz uygulanmamis fazlarin sayfa yer tutucusu. Yonlendirme agacinin
 * bastan dogru kurulmasi, sonraki fazlarda yalnizca icerigin degismesini
 * saglar.
 */
export default function Yakinda({ title, phase }: { title: string; phase: string }) {
  return (
    <>
      <PageHeader title={title} />
      <Card>
        <EmptyState
          icon={Hammer}
          title="Bu bolum henuz hazir degil"
          description={`${phase} kapsaminda eklenecek.`}
        />
      </Card>
    </>
  );
}
