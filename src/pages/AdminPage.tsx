import { useState } from 'react';
import AppLayout from '@/components/AppLayout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import AllocationManager from '@/components/admin/AllocationManager';
import PerformanceDashboard from '@/components/admin/PerformanceDashboard';
import AdminReports from '@/components/admin/AdminReports';

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState('allocation');

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Administrator</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage coordinator allocations, monitor performance, and generate reports</p>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="allocation">Allocation</TabsTrigger>
            <TabsTrigger value="performance">Performance</TabsTrigger>
            <TabsTrigger value="reports">Reports</TabsTrigger>
          </TabsList>

          <TabsContent value="allocation">
            <AllocationManager />
          </TabsContent>
          <TabsContent value="performance">
            <PerformanceDashboard />
          </TabsContent>
          <TabsContent value="reports">
            <AdminReports />
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
