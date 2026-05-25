import { useCallback, useEffect, useMemo, useState } from "react";
import AppLayout from "@/components/AppLayout";
import { ChevronLeft, ChevronRight, Pencil, Trash2, X } from "lucide-react";

type Booking = {
  id: number;
  learnerEmail: string;
  learnerName: string;
  coach: string;
  sessionType: "PR" | "MCM" | "Support";
  date: string;
  time: string;
  notes: string;
  bookingUrl: string;
  createdAt: string;
};

const SESSION_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  PR:      { bg: "#F3EEFF", text: "#644d93", dot: "#644d93" },
  MCM:     { bg: "#FFF8EE", text: "#b27715", dot: "#b27715" },
  Support: { bg: "#F0FFF6", text: "#2E9E5B", dot: "#2E9E5B" },
};

const SESSION_LABELS: Record<string, string> = {
  PR: "Progress Review",
  MCM: "Monthly Coaching Meeting",
  Support: "Support Session",
};

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function isoDate(y: number, m: number, d: number) {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function getMonthGrid(year: number, month: number) {
  const firstDay = new Date(year, month, 1).getDay();
  const offset = firstDay === 0 ? 6 : firstDay - 1;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrev = new Date(year, month, 0).getDate();

  const cells: Array<{ date: string; current: boolean }> = [];
  for (let i = offset - 1; i >= 0; i--) {
    cells.push({ date: isoDate(year, month - 1, daysInPrev - i), current: false });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ date: isoDate(year, month, d), current: true });
  }
  const remaining = 42 - cells.length;
  for (let d = 1; d <= remaining; d++) {
    cells.push({ date: isoDate(year, month + 1, d), current: false });
  }
  return cells;
}

export default function CalendarPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"month" | "week">("month");
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [month, setMonth] = useState(() => new Date().getMonth());
  const [weekStart, setWeekStart] = useState<Date>(() => {
    const today = new Date();
    const day = today.getDay();
    const diff = day === 0 ? 6 : day - 1;
    const mon = new Date(today);
    mon.setDate(today.getDate() - diff);
    mon.setHours(0, 0, 0, 0);
    return mon;
  });
  const [selected, setSelected] = useState<Booking | null>(null);
  const [editing, setEditing] = useState(false);
  const [editDate, setEditDate] = useState("");
  const [editTime, setEditTime] = useState("");
  const [editNotes, setEditNotes] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/bookings/");
      const data = await res.json();
      setBookings(Array.isArray(data) ? data : []);
    } catch {
      setBookings([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const byDate = useMemo(() => {
    const m = new Map<string, Booking[]>();
    for (const b of bookings) {
      const arr = m.get(b.date) ?? [];
      arr.push(b);
      m.set(b.date, arr);
    }
    return m;
  }, [bookings]);

  const today = new Date().toISOString().slice(0, 10);

  const deleteBooking = async (id: number) => {
    await fetch(`/api/bookings/?id=${id}`, { method: "DELETE" });
    setBookings((prev) => prev.filter((b) => b.id !== id));
    setSelected(null);
  };

  // ── Month navigation ────────────────────────────────────────────────
  const prevMonth = () => {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
  };

  // ── Week navigation ─────────────────────────────────────────────────
  const prevWeek = () => setWeekStart(d => { const n = new Date(d); n.setDate(d.getDate() - 7); return n; });
  const nextWeek = () => setWeekStart(d => { const n = new Date(d); n.setDate(d.getDate() + 7); return n; });

  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    return d;
  }), [weekStart]);

  const grid = useMemo(() => getMonthGrid(year, month), [year, month]);

  return (
    <AppLayout>
      <div className="min-h-screen bg-[#F8F8F8] p-4 sm:p-5 lg:p-6">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <div>
            <h1 className="text-xl font-bold text-[#4C4C4C]">Booking Calendar</h1>
            <p className="text-xs text-[#808080] mt-0.5">Sessions booked from the dashboard</p>
          </div>

          <div className="flex items-center gap-2">
            {/* Legend */}
            <div className="hidden sm:flex items-center gap-3 mr-3">
              {Object.entries(SESSION_LABELS).map(([key, label]) => (
                <div key={key} className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ background: SESSION_COLORS[key].dot }} />
                  <span className="text-xs text-[#808080]">{label}</span>
                </div>
              ))}
            </div>

            {/* View toggle */}
            <div className="flex rounded-lg border border-[#E4E4E4] bg-white overflow-hidden">
              {(["month", "week"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className="px-3 py-1.5 text-xs font-medium capitalize transition-colors"
                  style={view === v
                    ? { background: "#644d93", color: "#fff" }
                    : { color: "#808080" }
                  }
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Calendar card */}
        <div className="rounded-2xl border border-[#E4E4E4] bg-white shadow-sm overflow-hidden">
          {/* Nav bar */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[#EDEDED]">
            <button
              onClick={view === "month" ? prevMonth : prevWeek}
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[#F8F8F8] text-[#808080]"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <h2 className="text-sm font-semibold text-[#4C4C4C]">
              {view === "month"
                ? `${MONTHS[month]} ${year}`
                : `${weekDays[0].toLocaleDateString("en-GB", { day: "2-digit", month: "short" })} – ${weekDays[6].toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}`
              }
            </h2>

            <button
              onClick={view === "month" ? nextMonth : nextWeek}
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[#F8F8F8] text-[#808080]"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Day headers */}
          <div className="grid grid-cols-7 border-b border-[#EDEDED]">
            {DAYS.map((d) => (
              <div key={d} className="py-2 text-center text-xs font-semibold text-[#808080]">{d}</div>
            ))}
          </div>

          {loading ? (
            <div className="h-64 flex items-center justify-center text-sm text-[#808080]">Loading…</div>
          ) : view === "month" ? (
            // ── Month view ──────────────────────────────────────────────
            <div className="grid grid-cols-7">
              {grid.map((cell, idx) => {
                const cellBookings = byDate.get(cell.date) ?? [];
                const isToday = cell.date === today;
                return (
                  <div
                    key={idx}
                    className="min-h-[100px] border-b border-r border-[#F1F1F1] p-1.5 last:border-r-0"
                    style={{ opacity: cell.current ? 1 : 0.35 }}
                  >
                    <div className={`w-6 h-6 flex items-center justify-center rounded-full text-xs mb-1 font-medium ${
                      isToday ? "text-white" : "text-[#4C4C4C]"
                    }`} style={isToday ? { background: "#644d93" } : {}}>
                      {Number(cell.date.slice(-2))}
                    </div>
                    <div className="space-y-0.5">
                      {cellBookings.slice(0, 3).map((b) => (
                        <button
                          key={b.id}
                          onClick={() => setSelected(b)}
                          className="w-full text-left rounded px-1.5 py-0.5 text-[11px] font-medium truncate"
                          style={{ background: SESSION_COLORS[b.sessionType]?.bg, color: SESSION_COLORS[b.sessionType]?.text }}
                        >
                          {b.time} {b.learnerName}
                        </button>
                      ))}
                      {cellBookings.length > 3 && (
                        <p className="text-[10px] text-[#808080] pl-1">+{cellBookings.length - 3} more</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            // ── Week view ────────────────────────────────────────────────
            <div className="grid grid-cols-7">
              {weekDays.map((day) => {
                const dateStr = day.toISOString().slice(0, 10);
                const dayBookings = byDate.get(dateStr) ?? [];
                const isToday = dateStr === today;
                return (
                  <div key={dateStr} className="min-h-[300px] border-r border-[#F1F1F1] last:border-r-0 p-2">
                    <div className={`w-7 h-7 flex items-center justify-center rounded-full text-xs font-semibold mb-2 mx-auto ${
                      isToday ? "text-white" : "text-[#4C4C4C]"
                    }`} style={isToday ? { background: "#644d93" } : {}}>
                      {day.getDate()}
                    </div>
                    <div className="space-y-1">
                      {dayBookings.map((b) => (
                        <button
                          key={b.id}
                          onClick={() => setSelected(b)}
                          className="w-full text-left rounded-lg p-2 text-[11px] font-medium"
                          style={{ background: SESSION_COLORS[b.sessionType]?.bg, color: SESSION_COLORS[b.sessionType]?.text }}
                        >
                          <div>{b.time}</div>
                          <div className="font-semibold truncate">{b.learnerName}</div>
                          <div className="opacity-75 truncate">{SESSION_LABELS[b.sessionType]}</div>
                        </button>
                      ))}
                      {!dayBookings.length && (
                        <p className="text-[10px] text-[#D6D6D6] text-center pt-4">—</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Booking detail panel */}
        {selected && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => { setSelected(null); setEditing(false); }}>
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-start justify-between mb-4">
                <div>
                  <span
                    className="inline-block text-xs font-semibold rounded-full px-2.5 py-0.5 mb-2"
                    style={{ background: SESSION_COLORS[selected.sessionType]?.bg, color: SESSION_COLORS[selected.sessionType]?.text }}
                  >
                    {SESSION_LABELS[selected.sessionType]}
                  </span>
                  <h3 className="text-base font-bold text-[#4C4C4C]">{selected.learnerName}</h3>
                </div>
                <button onClick={() => { setSelected(null); setEditing(false); }} className="text-[#808080] hover:text-[#4C4C4C]">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {editing ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium text-[#808080] block mb-1">Date</label>
                      <input
                        type="date"
                        value={editDate}
                        onChange={(e) => setEditDate(e.target.value)}
                        className="w-full h-9 rounded-lg border border-[#E4E4E4] px-3 text-sm text-[#4C4C4C] outline-none focus:border-[#866CB6]"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-[#808080] block mb-1">Time</label>
                      <input
                        type="time"
                        value={editTime}
                        onChange={(e) => setEditTime(e.target.value)}
                        className="w-full h-9 rounded-lg border border-[#E4E4E4] px-3 text-sm text-[#4C4C4C] outline-none focus:border-[#866CB6]"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-[#808080] block mb-1">Notes</label>
                    <textarea
                      value={editNotes}
                      onChange={(e) => setEditNotes(e.target.value)}
                      rows={2}
                      className="w-full rounded-lg border border-[#E4E4E4] px-3 py-2 text-sm text-[#4C4C4C] outline-none focus:border-[#866CB6] resize-none"
                    />
                  </div>
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => setEditing(false)}
                      className="flex-1 h-9 rounded-lg border border-[#E4E4E4] text-sm text-[#808080] hover:bg-[#F8F8F8]"
                    >
                      Cancel
                    </button>
                    <button
                      disabled={!editDate || !editTime}
                      onClick={async () => {
                        await fetch(`/api/bookings/?id=${selected.id}`, {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ date: editDate, time: editTime, notes: editNotes }),
                        });
                        const updated = { ...selected, date: editDate, time: editTime, notes: editNotes };
                        setBookings((prev) => prev.map((b) => b.id === selected.id ? updated : b));
                        setSelected(updated);
                        setEditing(false);
                      }}
                      className="flex-1 h-9 rounded-lg text-sm font-semibold text-white disabled:opacity-40"
                      style={{ background: "#644d93" }}
                    >
                      Save Changes
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-[#808080]">Date</span>
                      <span className="font-medium text-[#4C4C4C]">{selected.date}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#808080]">Time</span>
                      <span className="font-medium text-[#4C4C4C]">{selected.time}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#808080]">Coach</span>
                      <span className="font-medium text-[#4C4C4C]">{selected.coach}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#808080]">Email</span>
                      <span className="font-medium text-[#4C4C4C] truncate ml-4">{selected.learnerEmail}</span>
                    </div>
                    {selected.notes && (
                      <div className="pt-1">
                        <p className="text-[#808080] mb-1">Notes</p>
                        <p className="text-[#4C4C4C] bg-[#F8F8F8] rounded-lg p-2 text-xs">{selected.notes}</p>
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2 mt-5">
                    {selected.bookingUrl && (
                      <button
                        onClick={() => window.open(selected.bookingUrl, "booking", "width=900,height=700,left=200,top=100")}
                        className="flex-1 h-9 rounded-lg text-sm font-semibold text-white"
                        style={{ background: "#644d93" }}
                      >
                        Open Booking
                      </button>
                    )}
                    <button
                      onClick={() => { setEditDate(selected.date); setEditTime(selected.time); setEditNotes(selected.notes); setEditing(true); }}
                      className="h-9 w-9 flex items-center justify-center rounded-lg border border-[#E4E4E4] text-[#644d93] hover:bg-[#F3EEFF]"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => deleteBooking(selected.id)}
                      className="h-9 w-9 flex items-center justify-center rounded-lg border border-[#E4E4E4] text-red-400 hover:bg-red-50"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
