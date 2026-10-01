import { Clock3, Phone, PhoneCall } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type AccountHours = {
  key: string;
  label: string;
  calls: number;
  duration_seconds: number;
  answered_duration_seconds: number;
  answered: number;
};

type Props = {
  open: boolean;
  onClose: () => void;
  accounts: AccountHours[];
  from: string;
  to: string;
  direction: string;
};

const hours = (seconds: number) => (seconds / 3600).toFixed(2);

export default function ZoomHoursDialog({ open, onClose, accounts, from, to, direction }: Props) {
  const totals = accounts.reduce((result, account) => ({
    calls: result.calls + account.calls,
    answered: result.answered + account.answered,
    duration: result.duration + account.duration_seconds,
    connected: result.connected + account.answered_duration_seconds,
  }), { calls: 0, answered: 0, duration: 0, connected: 0 });

  return <Dialog open={open} onOpenChange={next => { if (!next) onClose(); }}>
    <DialogContent className="max-h-[85dvh] w-[calc(100%_-_2rem)] max-w-2xl overflow-y-auto">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2 pr-6 tracking-normal">
          <Clock3 className="h-5 w-5 text-[#5B47D5]" /> Account call hours
        </DialogTitle>
        <DialogDescription>{from} to {to}, both Zoom accounts, {direction === "all" ? "all calls" : direction === "outbound" ? "outgoing calls" : "incoming calls"}</DialogDescription>
      </DialogHeader>

      <div className="divide-y rounded-lg border border-[#E2DCF8]">
        {accounts.map(account => <section key={account.key} className="grid gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(300px,1.25fr)] sm:items-center">
          <div>
            <p className="font-semibold text-[#1D1050]">{account.label}</p>
            <p className="text-xs text-[#9B94C8]">{account.key === "office" ? "Office Zoom account" : "Student Zoom account"}</p>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold leading-tight text-[#9B94C8]">Connected hours</p>
              <p className="mt-1 text-xl font-extrabold tabular-nums text-[#1C9B7A]">{hours(account.answered_duration_seconds)}</p>
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold leading-tight text-[#9B94C8]">All call hours</p>
              <p className="mt-1 text-xl font-extrabold tabular-nums text-[#5B47D5]">{hours(account.duration_seconds)}</p>
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold leading-tight text-[#9B94C8]">Calls</p>
              <p className="mt-1 text-xl font-extrabold tabular-nums text-[#1D1050]">{account.calls}</p>
            </div>
          </div>
        </section>)}
      </div>

      <section className="grid grid-cols-2 gap-3 rounded-lg bg-[#F5F3FC] p-4 sm:grid-cols-4">
        <div><PhoneCall className="mb-2 h-4 w-4 text-[#1C9B7A]" /><p className="text-xs text-[#6E6D8A]">Connected hours</p><p className="font-bold tabular-nums text-[#1C9B7A]">{hours(totals.connected)}</p></div>
        <div><Clock3 className="mb-2 h-4 w-4 text-[#5B47D5]" /><p className="text-xs text-[#6E6D8A]">All call hours</p><p className="font-bold tabular-nums text-[#5B47D5]">{hours(totals.duration)}</p></div>
        <div><Phone className="mb-2 h-4 w-4 text-[#1D1050]" /><p className="text-xs text-[#6E6D8A]">Calls</p><p className="font-bold tabular-nums text-[#1D1050]">{totals.calls}</p></div>
        <div><PhoneCall className="mb-2 h-4 w-4 text-[#1D1050]" /><p className="text-xs text-[#6E6D8A]">Answered</p><p className="font-bold tabular-nums text-[#1D1050]">{totals.answered}</p></div>
      </section>
    </DialogContent>
  </Dialog>;
}
