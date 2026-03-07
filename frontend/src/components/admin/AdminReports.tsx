import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Download, FileText, Calendar } from 'lucide-react';
import { mockCoordinators, getCoordinatorPerformance } from '@/data/adminMockData';

type ReportType = 'daily-activity' | 'weekly-summary' | 'risk-snapshot';

export default function AdminReports() {
  const [reportType, setReportType] = useState<ReportType>('daily-activity');
  const [selectedCoordinator, setSelectedCoordinator] = useState('all');

  const activeCoordinators = mockCoordinators.filter(c => c.active);
  const perfData = useMemo(() => getCoordinatorPerformance('7days'), []);

  const exportCSV = (data: Record<string, any>[], filename: string) => {
    if (data.length === 0) return;
    const headers = Object.keys(data[0]);
    const csv = [
      headers.join(','),
      ...data.map(row => headers.map(h => `"${row[h]}"`).join(',')),
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filteredPerf = selectedCoordinator === 'all'
    ? perfData
    : perfData.filter(p => p.coordinatorId === selectedCoordinator);

  // Daily activity data (last 7 days per coordinator)
  const dailyActivityData = filteredPerf.map(p => ({
    Coordinator: p.coordinatorName,
    Calls: p.callsMade,
    Answered: p.answeredCalls,
    'Not Answered': p.notAnswered,
    Emails: p.emailsSent,
    'Escalations LM': p.escalationsLM,
    'Escalations HR': p.escalationsHR,
    'Appointments Booked': p.appointmentsBooked,
  }));

  // Weekly summary
  const weeklySummaryData = filteredPerf.map(p => ({
    Coordinator: p.coordinatorName,
    Caseload: p.assignedCaseload,
    'Total Calls': p.callsMade,
    'Answer Rate': `${p.assignedCaseload > 0 ? Math.round((p.answeredCalls / Math.max(p.callsMade, 1)) * 100) : 0}%`,
    Emails: p.emailsSent,
    Appointments: p.appointmentsBooked,
    Resolved: p.resolutionCount,
    'Resolution Rate': `${p.resolutionRate}%`,
    'SLA Compliance': `${p.slaCompliance}%`,
  }));

  // Risk snapshot
  const riskSnapshotData = filteredPerf.map(p => ({
    Coordinator: p.coordinatorName,
    'Missed Session': p.caseloadHealth.missedSession,
    'PR Due': p.caseloadHealth.reviewDue,
    'MCM Due': p.caseloadHealth.coachingDue,
    'OTJ Behind': p.caseloadHealth.otjBehind,
    'High Priority': p.caseloadHealth.highPriority,
    'Not contacted 0-2d': p.ageingBuckets['0-2'],
    'Not contacted 3-7d': p.ageingBuckets['3-7'],
    'Not contacted 8-14d': p.ageingBuckets['8-14'],
    'Not contacted 15+d': p.ageingBuckets['15+'],
  }));

  const currentData = reportType === 'daily-activity' ? dailyActivityData
    : reportType === 'weekly-summary' ? weeklySummaryData
    : riskSnapshotData;

  const reportLabels: Record<ReportType, string> = {
    'daily-activity': 'Daily Activity Report',
    'weekly-summary': 'Weekly Performance Summary',
    'risk-snapshot': 'Caseload Risk Snapshot',
  };

  return (
    <div className="space-y-6 mt-4">
      {/* Controls */}
      <div className="flex flex-wrap gap-3 items-center">
        <Select value={reportType} onValueChange={v => setReportType(v as ReportType)}>
          <SelectTrigger className="w-[240px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="daily-activity">Daily Activity Report</SelectItem>
            <SelectItem value="weekly-summary">Weekly Performance Summary</SelectItem>
            <SelectItem value="risk-snapshot">Caseload Risk Snapshot</SelectItem>
          </SelectContent>
        </Select>
        <Select value={selectedCoordinator} onValueChange={setSelectedCoordinator}>
          <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Coordinators</SelectItem>
            {activeCoordinators.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => exportCSV(currentData, `${reportType}-${new Date().toISOString().split('T')[0]}`)}>
          <Download className="w-3.5 h-3.5" /> Export CSV
        </Button>
      </div>

      {/* Report Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="w-4 h-4" /> {reportLabels[reportType]}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {currentData.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  {Object.keys(currentData[0]).map(header => (
                    <TableHead key={header} className={header !== 'Coordinator' ? 'text-right' : ''}>{header}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {currentData.map((row, i) => (
                  <TableRow key={i}>
                    {Object.entries(row).map(([key, val], j) => (
                      <TableCell key={j} className={`${key !== 'Coordinator' ? 'text-right' : 'font-medium text-foreground'}`}>
                        {String(val)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="p-8 text-center text-muted-foreground">No data available for selected filters</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
