import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { getCoordinatorPerformance } from '@/data/adminMockData';
import { Activity, TrendingUp, AlertCircle } from 'lucide-react';

type DateRange = 'today' | '7days' | '30days';

export default function PerformanceDashboard() {
  const [dateRange, setDateRange] = useState<DateRange>('7days');
  const perfData = useMemo(() => getCoordinatorPerformance(dateRange), [dateRange]);

  const chartData = perfData.map(p => ({
    name: p.coordinatorName.split(' ')[0],
    'Booked Appt': p.outcomeBreakdown.bookedAppointment,
    'Emailed': p.outcomeBreakdown.emailedDetails,
    'Escalated': p.outcomeBreakdown.escalated,
    'No Answer': p.outcomeBreakdown.noAnswer,
    'Other': p.outcomeBreakdown.other,
  }));

  return (
    <div className="space-y-6 mt-4">
      {/* Date Range Controls */}
      <div className="flex gap-2">
        {([['today', 'Today'], ['7days', 'Last 7 Days'], ['30days', 'Last 30 Days']] as const).map(([val, label]) => (
          <Button key={val} size="sm" variant={dateRange === val ? 'default' : 'outline'} onClick={() => setDateRange(val)}>
            {label}
          </Button>
        ))}
      </div>

      {/* SLA Widget */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {perfData.map(p => (
          <Card key={p.coordinatorId} className={`${p.slaCompliance < 90 ? 'border-severity-critical/50' : ''}`}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm font-medium text-foreground">{p.coordinatorName}</p>
                {p.slaCompliance < 90 && <AlertCircle className="w-4 h-4 text-severity-critical" />}
              </div>
              <p className="text-xs text-muted-foreground">SLA Compliance (2-day contact)</p>
              <p className={`text-2xl font-bold ${p.slaCompliance >= 90 ? 'text-severity-normal' : 'text-severity-critical'}`}>
                {p.slaCompliance}%
              </p>
              <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${p.slaCompliance >= 90 ? 'bg-severity-normal' : 'bg-severity-critical'}`}
                  style={{ width: `${p.slaCompliance}%` }}
                />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Performance KPIs Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><Activity className="w-4 h-4" /> Performance Metrics</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Coordinator</TableHead>
                <TableHead className="text-right">Caseload</TableHead>
                <TableHead className="text-right">Calls</TableHead>
                <TableHead className="text-right">Answered</TableHead>
                <TableHead className="text-right">Not Ans.</TableHead>
                <TableHead className="text-right">Emails</TableHead>
                <TableHead className="text-right">Esc. LM</TableHead>
                <TableHead className="text-right">Esc. HR</TableHead>
                <TableHead className="text-right">Appts</TableHead>
                <TableHead className="text-right">Resolved</TableHead>
                <TableHead className="text-right">Res. Rate</TableHead>
                <TableHead className="text-right">Avg 1st Contact</TableHead>
                <TableHead className="text-right">Avg Resolution</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {perfData.map(p => (
                <TableRow key={p.coordinatorId}>
                  <TableCell className="font-medium text-foreground">{p.coordinatorName}</TableCell>
                  <TableCell className="text-right">{p.assignedCaseload}</TableCell>
                  <TableCell className="text-right">{p.callsMade}</TableCell>
                  <TableCell className="text-right">{p.answeredCalls}</TableCell>
                  <TableCell className="text-right">{p.notAnswered}</TableCell>
                  <TableCell className="text-right">{p.emailsSent}</TableCell>
                  <TableCell className="text-right">{p.escalationsLM}</TableCell>
                  <TableCell className="text-right">{p.escalationsHR}</TableCell>
                  <TableCell className="text-right">{p.appointmentsBooked}</TableCell>
                  <TableCell className="text-right">{p.resolutionCount}</TableCell>
                  <TableCell className="text-right">{p.resolutionRate}%</TableCell>
                  <TableCell className="text-right">{p.avgTimeToFirstContact}h</TableCell>
                  <TableCell className="text-right">{p.avgTimeToResolution}h</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Outcome Breakdown Chart */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><TrendingUp className="w-4 h-4" /> Outcome Breakdown by Coordinator</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[350px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="Booked Appt" stackId="a" fill="hsl(var(--chart-3))" />
                <Bar dataKey="Emailed" stackId="a" fill="hsl(var(--chart-1))" />
                <Bar dataKey="Escalated" stackId="a" fill="hsl(var(--chart-4))" />
                <Bar dataKey="No Answer" stackId="a" fill="hsl(var(--chart-5))" />
                <Bar dataKey="Other" stackId="a" fill="hsl(var(--chart-2))" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Caseload Health */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Caseload Health per Coordinator</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Coordinator</TableHead>
                <TableHead className="text-right">Missed Sess.</TableHead>
                <TableHead className="text-right">PR Due</TableHead>
                <TableHead className="text-right">MCM Due</TableHead>
                <TableHead className="text-right">OTJ Behind</TableHead>
                <TableHead className="text-right">High Priority</TableHead>
                <TableHead className="text-right">0–2d</TableHead>
                <TableHead className="text-right">3–7d</TableHead>
                <TableHead className="text-right">8–14d</TableHead>
                <TableHead className="text-right">15+d</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {perfData.map(p => (
                <TableRow key={p.coordinatorId}>
                  <TableCell className="font-medium text-foreground">{p.coordinatorName}</TableCell>
                  <TableCell className="text-right">{p.caseloadHealth.missedSession}</TableCell>
                  <TableCell className="text-right">{p.caseloadHealth.reviewDue}</TableCell>
                  <TableCell className="text-right">{p.caseloadHealth.coachingDue}</TableCell>
                  <TableCell className="text-right">{p.caseloadHealth.otjBehind}</TableCell>
                  <TableCell className="text-right">
                    <Badge className={`text-[10px] border-0 ${p.caseloadHealth.highPriority > 0 ? 'bg-severity-overdue-bg text-severity-overdue-foreground' : 'bg-muted text-muted-foreground'}`}>
                      {p.caseloadHealth.highPriority}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right text-severity-normal">{p.ageingBuckets['0-2']}</TableCell>
                  <TableCell className="text-right text-severity-due-soon">{p.ageingBuckets['3-7']}</TableCell>
                  <TableCell className="text-right text-severity-overdue">{p.ageingBuckets['8-14']}</TableCell>
                  <TableCell className="text-right text-severity-critical">{p.ageingBuckets['15+']}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
