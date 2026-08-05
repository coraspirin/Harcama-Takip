import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';

type Tone = 'info' | 'success' | 'warning' | 'error';

const TONES: Record<Tone, { box: string; icon: typeof Info }> = {
  info: { box: 'bg-blue-50 text-blue-800 ring-blue-200', icon: Info },
  success: { box: 'bg-emerald-50 text-emerald-800 ring-emerald-200', icon: CheckCircle2 },
  warning: { box: 'bg-amber-50 text-amber-900 ring-amber-200', icon: AlertTriangle },
  error: { box: 'bg-red-50 text-red-800 ring-red-200', icon: XCircle },
};

export function Alert({
  tone = 'info',
  title,
  children,
}: {
  tone?: Tone;
  title?: string;
  children?: ReactNode;
}) {
  const { box, icon: Icon } = TONES[tone];

  return (
    <div className={`flex gap-3 rounded-lg px-4 py-3 text-sm ring-1 ring-inset ${box}`} role="alert">
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={title ? 'mt-0.5' : ''}>{children}</div>}
      </div>
    </div>
  );
}
