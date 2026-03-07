import AppLayout from '@/components/AppLayout';
import { mockDailyActivity } from '@/data/mockData';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { Phone, PhoneOff, AlertTriangle, Calendar, Mail, PhoneCall } from 'lucide-react';

export default function ActivityReport() {
  const last7 = mockDailyActivity.slice(-7);
  const totals = mockDailyActivity.reduce(
    (acc, d) => ({
      calls: acc.calls + d.callsMade,
      answered: acc.answered + d.answered,
      notAnswered: acc.notAnswered + d.notAnswered,
      escalatedLM: acc.escalatedLM + d.escalatedLM,
      escalatedHR: acc.escalatedHR + d.escalatedHR,
      appointments: acc.appointments + d.appointmentsBooked,
      emails: acc.emails + d.emailsSent,
    }),
    { calls: 0, answered: 0, notAnswered: 0, escalatedLM: 0, escalatedHR: 0, appointments: 0, emails: 0 }
  );

  const pieData = [
    { name: 'Answered', value: totals.answered },
    { name: 'Not Answered', value: totals.notAnswered },
    { name: 'Escalated LM', value: totals.escalatedLM },
    { name: 'Escalated HR', value: totals.escalatedHR },
  ];
  const pieColors = ['hsl(142,71%,45%)', 'hsl(0,72%,51%)', 'hsl(38,92%,50%)', 'hsl(262,83%,58%)'];

  const stats = [
    { label: 'Total Calls', value: totals.calls, icon: Phone },
    { label: 'Answered', value: totals.answered, icon: PhoneCall },
    { label: 'Not Answered', value: totals.notAnswered, icon: PhoneOff },
    { label: 'Escalated (LM)', value: totals.escalatedLM, icon: AlertTriangle },
    { label: 'Escalated (HR)', value: totals.escalatedHR, icon: AlertTriangle },
    { label: 'Appointments Booked', value: totals.appointments, icon: Calendar },
    { label: 'Emails Sent', value: totals.emails, icon: Mail },
  ];

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-foreground">Engagement Activity Report</h2>
            <p className="text-sm text-muted-foreground">Last 30 days</p>
          </div>
          <Badge variant="secondary">Month to Date</Badge>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          {stats.map(s => (
            <Card key={s.label} className="p-4 text-center">
              <s.icon className="w-4 h-4 mx-auto mb-2 text-muted-foreground" />
              <p className="text-2xl font-bold text-foreground">{s.value}</p>
              <p className="text-[11px] text-muted-foreground mt-1">{s.label}</p>
            </Card>
          ))}
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-2 p-5">
            <p className="text-sm font-medium text-foreground mb-4">Calls by Day (Last 7 Days)</p>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={last7}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(214,32%,91%)" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={v => new Date(v).toLocaleDateString([], { day: 'numeric', month: 'short' })} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="answered" stackId="a" fill="hsl(142,71%,45%)" name="Answered" radius={[0, 0, 0, 0]} />
                <Bar dataKey="notAnswered" stackId="a" fill="hsl(0,72%,51%)" name="Not Answered" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>

          <Card className="p-5">
            <p className="text-sm font-medium text-foreground mb-4">Outcomes Breakdown</p>
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={90} dataKey="value" paddingAngle={2}>
                  {pieData.map((_, i) => <Cell key={i} fill={pieColors[i]} />)}
                </Pie>
                <Legend wrapperStyle={{ fontSize: '11px' }} />
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </Card>
        </div>

        {/* Activity log table */}
        <Card className="overflow-x-auto">
          <div className="p-4 border-b">
            <p className="text-sm font-medium text-foreground">Daily Activity Log</p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="p-3 text-left font-medium text-muted-foreground">Date</th>
                <th className="p-3 text-right font-medium text-muted-foreground">Calls</th>
                <th className="p-3 text-right font-medium text-muted-foreground">Answered</th>
                <th className="p-3 text-right font-medium text-muted-foreground">Not Answered</th>
                <th className="p-3 text-right font-medium text-muted-foreground">Escalated LM</th>
                <th className="p-3 text-right font-medium text-muted-foreground">Escalated HR</th>
                <th className="p-3 text-right font-medium text-muted-foreground">Appts Booked</th>
                <th className="p-3 text-right font-medium text-muted-foreground">Emails Sent</th>
              </tr>
            </thead>
            <tbody>
              {mockDailyActivity.slice(-14).reverse().map(d => (
                <tr key={d.date} className="border-b hover:bg-muted/30">
                  <td className="p-3 font-medium text-foreground">{new Date(d.date).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}</td>
                  <td className="p-3 text-right text-muted-foreground">{d.callsMade}</td>
                  <td className="p-3 text-right text-muted-foreground">{d.answered}</td>
                  <td className="p-3 text-right text-muted-foreground">{d.notAnswered}</td>
                  <td className="p-3 text-right text-muted-foreground">{d.escalatedLM}</td>
                  <td className="p-3 text-right text-muted-foreground">{d.escalatedHR}</td>
                  <td className="p-3 text-right text-muted-foreground">{d.appointmentsBooked}</td>
                  <td className="p-3 text-right text-muted-foreground">{d.emailsSent}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </AppLayout>
  );
}
