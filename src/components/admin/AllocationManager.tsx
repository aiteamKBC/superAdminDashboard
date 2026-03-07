import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Users, RefreshCw, UserCheck } from 'lucide-react';
import { mockLearners } from '@/data/mockData';
import { mockCoordinators, mockAssignments, getLastContactDate, getNextFollowUpDate } from '@/data/adminMockData';

const kpiLabels: Record<string, string> = {
  'missed-session': 'Missed Session',
  'review-due': 'PR Due',
  'coaching-due': 'MCM Due',
  'otj-behind': 'OTJ Behind',
};

const workloadColors: Record<string, string> = {
  light: 'bg-severity-normal-bg text-severity-normal-foreground',
  normal: 'bg-severity-due-soon-bg text-severity-due-soon-foreground',
  heavy: 'bg-severity-critical-bg text-severity-critical-foreground',
};

export default function AllocationManager() {
  const [selectedLearners, setSelectedLearners] = useState<Set<string>>(new Set());
  const [assignments, setAssignments] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    mockAssignments.forEach(a => { map[a.learnerId] = a.coordinatorId; });
    return map;
  });
  const [filterProgramme, setFilterProgramme] = useState('all');
  const [filterOrg, setFilterOrg] = useState('all');
  const [filterCoordinator, setFilterCoordinator] = useState('all');
  const [filterPriority, setFilterPriority] = useState('all');
  const [filterRisk, setFilterRisk] = useState('all');
  const [bulkCoordinator, setBulkCoordinator] = useState('');
  const [showBulkConfirm, setShowBulkConfirm] = useState(false);
  const [showRebalanceConfirm, setShowRebalanceConfirm] = useState(false);

  const programmes = useMemo(() => [...new Set(mockLearners.map(l => l.programme))], []);
  const organisations = useMemo(() => [...new Set(mockLearners.map(l => l.organisation))], []);
  const activeCoordinators = mockCoordinators.filter(c => c.active);

  const filteredLearners = useMemo(() => {
    return mockLearners.filter(l => {
      if (filterProgramme !== 'all' && l.programme !== filterProgramme) return false;
      if (filterOrg !== 'all' && l.organisation !== filterOrg) return false;
      if (filterCoordinator !== 'all' && assignments[l.id] !== filterCoordinator) return false;
      if (filterPriority !== 'all' && l.priority !== filterPriority) return false;
      if (filterRisk !== 'all' && !l.riskCategories.includes(filterRisk as any)) return false;
      return true;
    });
  }, [filterProgramme, filterOrg, filterCoordinator, filterPriority, filterRisk, assignments]);

  const toggleSelect = (id: string) => {
    setSelectedLearners(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedLearners.size === filteredLearners.length) {
      setSelectedLearners(new Set());
    } else {
      setSelectedLearners(new Set(filteredLearners.map(l => l.id)));
    }
  };

  const handleSingleAssign = (learnerId: string, coordId: string) => {
    setAssignments(prev => ({ ...prev, [learnerId]: coordId }));
  };

  const handleBulkAssign = () => {
    if (!bulkCoordinator) return;
    setAssignments(prev => {
      const next = { ...prev };
      selectedLearners.forEach(id => { next[id] = bulkCoordinator; });
      return next;
    });
    setSelectedLearners(new Set());
    setBulkCoordinator('');
    setShowBulkConfirm(false);
  };

  const handleRebalance = () => {
    const learnerIds = mockLearners.map(l => l.id);
    const coords = activeCoordinators.map(c => c.id);
    setAssignments(() => {
      const next: Record<string, string> = {};
      learnerIds.forEach((id, i) => { next[id] = coords[i % coords.length]; });
      return next;
    });
    setShowRebalanceConfirm(false);
  };

  // Compute caseload sizes from current assignments
  const caseloadSizes = useMemo(() => {
    const sizes: Record<string, number> = {};
    mockCoordinators.forEach(c => { sizes[c.id] = 0; });
    Object.values(assignments).forEach(cId => { sizes[cId] = (sizes[cId] || 0) + 1; });
    return sizes;
  }, [assignments]);

  return (
    <div className="space-y-6 mt-4">
      {/* Coordinator List Panel */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><Users className="w-4 h-4" /> Engagement Coordinators</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
            {mockCoordinators.map(coord => (
              <div key={coord.id} className={`rounded-lg border p-3 space-y-2 ${!coord.active ? 'opacity-50' : ''}`}>
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-foreground">{coord.name}</p>
                  <Badge variant={coord.active ? 'default' : 'secondary'} className="text-[10px]">{coord.active ? 'Active' : 'Inactive'}</Badge>
                </div>
                <div className="text-xs text-muted-foreground">Caseload: <span className="font-semibold text-foreground">{caseloadSizes[coord.id] || 0}</span></div>
                <Badge className={`text-[10px] border-0 ${workloadColors[coord.workload]}`}>{coord.workload}</Badge>
                <div className="flex flex-wrap gap-1 mt-1">
                  {Object.entries(coord.kpiBreakdown).map(([key, pct]) => (
                    pct > 0 && <span key={key} className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{kpiLabels[key]}: {pct}%</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <Select value={filterProgramme} onValueChange={setFilterProgramme}>
          <SelectTrigger className="w-[180px]"><SelectValue placeholder="Programme" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Programmes</SelectItem>
            {programmes.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterOrg} onValueChange={setFilterOrg}>
          <SelectTrigger className="w-[180px]"><SelectValue placeholder="Organisation" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Organisations</SelectItem>
            {organisations.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterCoordinator} onValueChange={setFilterCoordinator}>
          <SelectTrigger className="w-[180px]"><SelectValue placeholder="Coordinator" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Coordinators</SelectItem>
            {mockCoordinators.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterPriority} onValueChange={setFilterPriority}>
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="Priority" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Priorities</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="normal">Normal</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterRisk} onValueChange={setFilterRisk}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Risk Flag" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Risk Flags</SelectItem>
            <SelectItem value="missed-session">Missed Session</SelectItem>
            <SelectItem value="review-due">PR Due</SelectItem>
            <SelectItem value="coaching-due">MCM Due</SelectItem>
            <SelectItem value="otj-behind">OTJ Behind</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Bulk Actions */}
      {selectedLearners.size > 0 && (
        <div className="flex items-center gap-3 bg-primary/5 border border-primary/20 rounded-lg px-4 py-3">
          <span className="text-sm font-medium text-foreground">{selectedLearners.size} selected</span>
          <Select value={bulkCoordinator} onValueChange={setBulkCoordinator}>
            <SelectTrigger className="w-[200px]"><SelectValue placeholder="Assign to…" /></SelectTrigger>
            <SelectContent>
              {activeCoordinators.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" disabled={!bulkCoordinator} onClick={() => setShowBulkConfirm(true)} className="gap-1.5">
            <UserCheck className="w-3.5 h-3.5" /> Assign
          </Button>
          <Button size="sm" variant="outline" onClick={() => setShowRebalanceConfirm(true)} className="gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" /> Rebalance All
          </Button>
        </div>
      )}

      {selectedLearners.size === 0 && (
        <div className="flex justify-end">
          <Button size="sm" variant="outline" onClick={() => setShowRebalanceConfirm(true)} className="gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" /> Rebalance Automatically
          </Button>
        </div>
      )}

      {/* Learner Allocation Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox checked={selectedLearners.size === filteredLearners.length && filteredLearners.length > 0} onCheckedChange={toggleAll} />
                </TableHead>
                <TableHead>Learner</TableHead>
                <TableHead>Programme</TableHead>
                <TableHead>Organisation</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Risk Flags</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Coordinator</TableHead>
                <TableHead>Last Contact</TableHead>
                <TableHead>Next Follow-up</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredLearners.map(learner => (
                <TableRow key={learner.id}>
                  <TableCell>
                    <Checkbox checked={selectedLearners.has(learner.id)} onCheckedChange={() => toggleSelect(learner.id)} />
                  </TableCell>
                  <TableCell className="font-medium text-foreground">{learner.firstName} {learner.lastName}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{learner.programme}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{learner.organisation}</TableCell>
                  <TableCell>
                    <Badge variant={learner.status === 'Active' ? 'default' : 'secondary'} className="text-[10px]">{learner.status}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {learner.riskCategories.map(c => (
                        <Badge key={c} variant="outline" className="text-[10px]">{kpiLabels[c]}</Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge className={`text-[10px] border-0 ${
                      learner.priority === 'critical' ? 'bg-severity-critical-bg text-severity-critical-foreground' :
                      learner.priority === 'high' ? 'bg-severity-overdue-bg text-severity-overdue-foreground' :
                      'bg-muted text-muted-foreground'
                    }`}>
                      {learner.priority}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Select value={assignments[learner.id] || ''} onValueChange={v => handleSingleAssign(learner.id, v)}>
                      <SelectTrigger className="h-8 w-[150px] text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {activeCoordinators.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{getLastContactDate(learner.id)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{getNextFollowUpDate(learner.id)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Bulk Assign Confirm */}
      <AlertDialog open={showBulkConfirm} onOpenChange={setShowBulkConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Bulk Assignment</AlertDialogTitle>
            <AlertDialogDescription>
              Assign {selectedLearners.size} learner(s) to {activeCoordinators.find(c => c.id === bulkCoordinator)?.name}? This action will be logged in the audit trail.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleBulkAssign}>Confirm</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Rebalance Confirm */}
      <AlertDialog open={showRebalanceConfirm} onOpenChange={setShowRebalanceConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Automatic Rebalance</AlertDialogTitle>
            <AlertDialogDescription>
              This will redistribute all learners evenly across active coordinators. Inactive coordinators will be excluded. This action will be logged.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRebalance}>Rebalance</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
