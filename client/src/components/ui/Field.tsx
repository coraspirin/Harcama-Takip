import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';

const CONTROL =
  'block w-full rounded-lg border-0 px-3 py-2.5 text-slate-900 ring-1 ring-inset ring-slate-300 ' +
  'placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-brand-600 ' +
  'disabled:bg-slate-50 disabled:text-slate-500 sm:text-sm';

const CONTROL_ERROR = 'ring-red-400 focus:ring-red-600';

type LabelProps = {
  label: string;
  hint?: ReactNode;
  error?: string | undefined;
  children: (id: string, describedBy: string | undefined) => ReactNode;
};

function FieldShell({ label, hint, error, children }: LabelProps) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-slate-700">
        {label}
      </label>
      {children(id, describedBy)}
      {error ? (
        <p id={`${id}-error`} className="mt-1.5 text-sm text-red-600">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-sm text-slate-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> & {
  label: string;
  hint?: ReactNode;
  error?: string | undefined;
};

export function TextField({ label, hint, error, className = '', ...rest }: TextFieldProps) {
  return (
    <FieldShell label={label} hint={hint} error={error}>
      {(id, describedBy) => (
        <input
          {...rest}
          id={id}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          className={`${CONTROL} ${error ? CONTROL_ERROR : ''} ${className}`}
        />
      )}
    </FieldShell>
  );
}

type SelectFieldProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> & {
  label: string;
  hint?: ReactNode;
  error?: string | undefined;
  children: ReactNode;
};

export function SelectField({
  label,
  hint,
  error,
  className = '',
  children,
  ...rest
}: SelectFieldProps) {
  return (
    <FieldShell label={label} hint={hint} error={error}>
      {(id, describedBy) => (
        <select
          {...rest}
          id={id}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          className={`${CONTROL} ${error ? CONTROL_ERROR : ''} ${className}`}
        >
          {children}
        </select>
      )}
    </FieldShell>
  );
}
