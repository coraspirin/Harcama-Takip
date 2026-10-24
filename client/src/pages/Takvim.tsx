import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useAsync } from '../hooks/useAsync.ts';
import { calendarService } from '../services/finance.ts';
import type { CalendarDay } from '../types/index.ts';
import { Alert } from '../components/ui/Alert.tsx';
import { Card, PageHeader } from '../components/ui/Card.tsx';
import { Money } from '../components/Money.tsx';
import { MonthPicker, currentYearMonth } from '../components/MonthPicker.tsx';
import { compactLira } from '../lib/chartPalette.ts';
import { formatDate } from '../lib/format.ts';

const WEEKDAYS = ['Pzt', 'Sal', 'Car', 'Per', 'Cum', 'Cmt', 'Paz'];

/** Pazartesi = 0 ... Pazar = 6 */
function weekdayIndex(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

function DayCell({ day, today }: { day: CalendarDay; today: string }) {
  const isToday = day.date === today;
  const hasMoves = day.incomeKurus > 0 || day.expenseKurus > 0 || day.pending.length > 0;

  return (
    <div
      className={`flex min-h-24 flex-col rounded-lg p-1.5 text-xs ring-1 ${
        day.tight ? 'bg-red-50 ring-red-200' : 'bg-white ring-slate-200'
      } ${isToday ? 'outline outline-2 outline-brand-600' : ''}`}
    >
      <span className={`font-medium ${isToday ? 'text-brand-600' : 'text-slate-700'}`}>
        {Number(day.date.slice(8))}
      </span>
      <div className="mt-0.5 flex-1 space-y-0.5">
        {day.incomeKurus > 0 && (
          <p className="tabular truncate text-emerald-600">+{compactLira(day.incomeKurus)}</p>
        )}
        {day.expenseKurus > 0 && (
          <p className="tabular truncate text-red-600">−{compactLira(day.expenseKurus)}</p>
        )}
        {day.pending.slice(0, 2).map((p) => (
          <p
            key={p.id}
            className={`truncate rounded px-1 ${
              p.overdue ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-700'
            }`}
            title={p.excludedFromBudget ? `${p.name} (butce disi)` : p.name}
          >
            {p.name}
          </p>
        ))}
        {day.pending.length > 2 && <p className="text-slate-400">+{day.pending.length - 2} kayit</p>}
      </div>
      {hasMoves && (
        <p className={`tabular mt-0.5 text-right ${day.tight ? 'font-medium text-red-700' : 'text-slate-400'}`}>
          {compactLira(day.cumulativeKurus)}
        </p>
      )}
    </div>
  );
}

export default function Takvim() {
  const [month, setMonth] = useState(currentYearMonth());
  const calendar = useAsync(() => calendarService.month(month), [month]);
  const data = calendar.data;

  const leading = data?.days[0] ? weekdayIndex(data.days[0].date) : 0;
  const activeDays = (data?.days ?? []).filter(
    (d) => d.incomeKurus > 0 || d.expenseKurus > 0 || d.pending.length > 0,
  );

  return (
    <>
      <PageHeader
        title="Takvim"
        description="Gelir ve odeme gunleri; ay icinde nakdin sikistigi gunler"
      />

      <div className="mb-4">
        <MonthPicker value={month} onChange={setMonth} />
      </div>

      {calendar.error && (
        <div className="mb-4">
          <Alert tone="error">{calendar.error}</Alert>
        </div>
      )}

      {data && (
        <div className={calendar.loading ? 'opacity-60 transition-opacity' : ''}>
          {data.tightDayCount > 0 ? (
            <div className="mb-4 flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-800 ring-1 ring-red-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <p>
                <strong>{data.tightDayCount} gun</strong> ay basindan beri giden, gelenden fazla
                gorunuyor. Bu gunlerde odemeler gelirden once geliyor; odeme tarihlerini kaydirmayi
                veya bir onceki aydan para ayirmayi dusunun.
              </p>
            </div>
          ) : (
            <p className="mb-4 text-sm text-slate-500">
              Bu ay net akis hicbir gun eksiye dusmuyor.
            </p>
          )}

          <p className="mb-3 text-xs text-slate-500">
            Her gunun altindaki rakam ay basindan o gunun sonuna kadar net akistir: gecmis gunlerde
            gerceklesen, bugun ve sonrasinda bekleyen odemeler dahil. Hesap bakiyesi tutulmadigi icin
            ay basi sifir kabul edilir.
          </p>

          {/* Genis ekran: ay izgarasi */}
          <div className="hidden sm:block">
            <div className="mb-1 grid grid-cols-7 gap-1 text-center text-xs font-medium text-slate-500">
              {WEEKDAYS.map((d) => (
                <span key={d}>{d}</span>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: leading }, (_, i) => (
                <div key={`bos-${i}`} />
              ))}
              {data.days.map((day) => (
                <DayCell key={day.date} day={day} today={data.today} />
              ))}
            </div>
          </div>

          {/* Dar ekran: yalnizca hareketli gunlerin listesi */}
          <div className="sm:hidden">
            <Card>
              {activeDays.length === 0 ? (
                <p className="text-sm text-slate-500">Bu ay hareket yok.</p>
              ) : (
                <ul className="-my-2 divide-y divide-slate-100">
                  {activeDays.map((day) => (
                    <li key={day.date} className={`py-2.5 ${day.tight ? 'text-red-800' : ''}`}>
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium">
                          {formatDate(day.date)}
                          {day.date === data.today && ' · bugun'}
                        </span>
                        <span className={`tabular text-xs ${day.tight ? 'font-medium text-red-700' : 'text-slate-500'}`}>
                          net <Money kurus={day.cumulativeKurus} />
                        </span>
                      </div>
                      <div className="mt-1 space-y-0.5 text-sm">
                        {day.incomeKurus > 0 && (
                          <p className="text-emerald-600">
                            Gelir +<Money kurus={day.incomeKurus} />
                          </p>
                        )}
                        {day.expenseKurus > 0 && (
                          <p className="text-red-600">
                            Gider −<Money kurus={day.expenseKurus} />
                          </p>
                        )}
                        {day.pending.map((p) => (
                          <p key={p.id} className={p.overdue ? 'text-red-700' : 'text-slate-600'}>
                            {p.overdue ? 'Gecikti: ' : 'Bekliyor: '}
                            {p.name}
                            {p.excludedFromBudget && ' (butce disi)'}
                            {p.amountKurus !== null && (
                              <>
                                {' '}
                                · {p.direction === 'income' ? '+' : '−'}
                                <Money kurus={p.amountKurus} />
                              </>
                            )}
                          </p>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <p className="mt-4 text-sm text-slate-600">
            Ay sonu net akis:{' '}
            <strong>
              <Money kurus={data.endCumulativeKurus} signed />
            </strong>
          </p>
        </div>
      )}
    </>
  );
}
