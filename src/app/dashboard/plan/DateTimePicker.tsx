"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { IconArrowLeft, IconCalendar } from "@/app/icons";

/**
 * Sustituye al `<input type="datetime-local">` nativo, cuyo aspecto lo
 * decide el sistema operativo y no encaja con el resto del panel (oscuro,
 * marca propia). El valor que entra y sale sigue el mismo formato que el
 * input nativo (`YYYY-MM-DD` o `YYYY-MM-DDTHH:mm`) para no tocar el código
 * que ya lo consume.
 */

interface Props {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  withTime?: boolean;
  placeholder?: string;
}

const WEEKDAYS = ["L", "M", "X", "J", "V", "S", "D"];
const MINUTES = [0, 15, 30, 45];
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const pad = (n: number) => String(n).padStart(2, "0");

function parseValue(value: string): { date: Date | null; hour: number; minute: number } {
  if (!value) return { date: null, hour: 10, minute: 0 };
  const [datePart = "", timePart] = value.split("T");
  const [y = 0, m = 1, d = 1] = datePart.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  if (timePart) {
    const [h = 10, mi = 0] = timePart.split(":").map(Number);
    return { date, hour: h, minute: mi };
  }
  return { date, hour: 10, minute: 0 };
}

function formatValue(date: Date, hour: number, minute: number, withTime: boolean): string {
  const d = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return withTime ? `${d}T${pad(hour)}:${pad(minute)}` : d;
}

function formatDisplay(date: Date, hour: number, minute: number, withTime: boolean): string {
  const d = date.toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" });
  return withTime ? `${d}, ${pad(hour)}:${pad(minute)}` : d;
}

function isSameDay(a: Date, b: Date | null): boolean {
  return (
    !!b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  );
}

export function DateTimePicker({ id, value, onChange, withTime = true, placeholder }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const { date: selected, hour, minute } = parseValue(value);
  const [viewDate, setViewDate] = useState(selected ?? new Date());

  // Si el valor cambia desde fuera (otro plan abierto, "Borrar"...), el mes
  // visible debe seguirlo en vez de quedarse en el que se abrió la primera vez.
  useEffect(() => {
    if (selected) setViewDate(selected);
  }, [value]);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const monthLabel = viewDate.toLocaleDateString("es-ES", { month: "long", year: "numeric" });

  const weeks = useMemo(() => {
    const first = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
    // La semana empieza en lunes: getDay() da 0 para domingo.
    const offset = (first.getDay() + 6) % 7;
    const start = new Date(first.getFullYear(), first.getMonth(), first.getDate() - offset);

    const days: Date[] = Array.from(
      { length: 42 },
      (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i),
    );
    const rows: Date[][] = [];
    for (let i = 0; i < 42; i += 7) rows.push(days.slice(i, i + 7));
    return rows;
  }, [viewDate]);

  // El minuto guardado puede no caer en los cuartos de hora del selector
  // (por ejemplo, uno programado a mano con otro valor): se añade a la lista
  // en vez de perderlo al no encontrar coincidencia.
  const minuteOptions = MINUTES.includes(minute) ? MINUTES : [...MINUTES, minute].sort((a, b) => a - b);

  function pick(day: Date) {
    onChange(formatValue(day, hour, minute, withTime));
    if (!withTime) setOpen(false);
  }

  function setTime(h: number, mi: number) {
    onChange(formatValue(selected ?? viewDate, h, mi, withTime));
  }

  return (
    <div className="dtp" ref={rootRef}>
      <button type="button" id={id} className="dtp-trigger" onClick={() => setOpen((o) => !o)}>
        <IconCalendar />
        <span className={selected ? undefined : "dtp-placeholder"}>
          {selected ? formatDisplay(selected, hour, minute, withTime) : (placeholder ?? "Elegir fecha")}
        </span>
      </button>

      {open && (
        <div className="dtp-panel" role="dialog" aria-label="Selector de fecha">
          <div className="dtp-nav">
            <button
              type="button"
              className="dtp-navbtn"
              aria-label="Mes anterior"
              onClick={() => setViewDate((v) => new Date(v.getFullYear(), v.getMonth() - 1, 1))}
            >
              <IconArrowLeft />
            </button>
            <strong>{monthLabel}</strong>
            <button
              type="button"
              className="dtp-navbtn"
              aria-label="Mes siguiente"
              style={{ transform: "rotate(180deg)" }}
              onClick={() => setViewDate((v) => new Date(v.getFullYear(), v.getMonth() + 1, 1))}
            >
              <IconArrowLeft />
            </button>
          </div>

          <div className="dtp-weekdays">
            {WEEKDAYS.map((w) => (
              <span key={w}>{w}</span>
            ))}
          </div>

          {weeks.map((week, wi) => (
            <div className="dtp-week" key={wi}>
              {week.map((day) => (
                <button
                  type="button"
                  key={day.toISOString()}
                  className="dtp-day"
                  data-outside={day.getMonth() !== viewDate.getMonth() || undefined}
                  data-selected={isSameDay(day, selected) || undefined}
                  data-today={isSameDay(day, new Date()) || undefined}
                  onClick={() => pick(day)}
                >
                  {day.getDate()}
                </button>
              ))}
            </div>
          ))}

          {withTime && (
            <div className="dtp-time">
              <select aria-label="Hora" value={hour} onChange={(e) => setTime(Number(e.target.value), minute)}>
                {HOURS.map((h) => (
                  <option key={h} value={h}>
                    {pad(h)}
                  </option>
                ))}
              </select>
              <span>:</span>
              <select
                aria-label="Minutos"
                value={minute}
                onChange={(e) => setTime(hour, Number(e.target.value))}
              >
                {minuteOptions.map((m) => (
                  <option key={m} value={m}>
                    {pad(m)}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="dtp-footer">
            <button
              type="button"
              className="dtp-link"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
            >
              Borrar
            </button>
            <button
              type="button"
              className="dtp-link"
              onClick={() => {
                const now = new Date();
                setViewDate(now);
                onChange(formatValue(now, withTime ? now.getHours() : hour, withTime ? 0 : minute, withTime));
              }}
            >
              Hoy
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
