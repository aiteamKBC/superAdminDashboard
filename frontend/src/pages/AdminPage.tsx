import { useEffect, useState } from 'react';
import AppLayout from '@/components/AppLayout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import AllocationManager from '@/components/admin/AllocationManager';
import PerformanceDashboard from '@/components/admin/PerformanceDashboard';
import AdminReports from '@/components/admin/AdminReports';
import { AdminRealData, loadAdminRealData } from '@/data/adminRealData';
import { Skeleton } from '@/components/ui/skeleton';

function AdminPageSkeleton() {
  return (
    <div className="mt-4 space-y-6">
      <div className="rounded-2xl border border-[#E4E4E4] bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <Skeleton className="h-4 w-4 rounded-full bg-[#EDE7F6]" />
          <Skeleton className="h-5 w-48 bg-[#EDE7F6]" />
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="rounded-xl border border-[#ECECEC] p-4">
              <div className="mb-3 flex items-center justify-between">
                <Skeleton className="h-4 w-32 bg-[#EDE7F6]" />
                <Skeleton className="h-6 w-14 rounded-full bg-[#F4E9DA]" />
              </div>
              <Skeleton className="mb-3 h-3 w-24 bg-[#EFEFEF]" />
              <Skeleton className="mb-3 h-6 w-16 rounded-full bg-[#F4E9DA]" />
              <div className="grid grid-cols-2 gap-2">
                <Skeleton className="h-6 rounded-md bg-[#F3F3F3]" />
                <Skeleton className="h-6 rounded-md bg-[#F3F3F3]" />
                <Skeleton className="h-6 rounded-md bg-[#F3F3F3]" />
                <Skeleton className="h-6 rounded-md bg-[#F3F3F3]" />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton key={index} className="h-11 w-[180px] rounded-xl bg-[#EFEFEF]" />
        ))}
      </div>

      <div className="flex justify-end">
        <Skeleton className="h-10 w-52 rounded-xl bg-[#EFEFEF]" />
      </div>

      <div className="overflow-hidden rounded-2xl border border-[#E4E4E4] bg-white shadow-sm">
        <div className="grid grid-cols-[48px_1fr_1fr_1fr_100px_1.3fr_100px_1.2fr_110px_120px] gap-4 border-b bg-[#FAF7FC] p-4">
          {Array.from({ length: 10 }).map((_, index) => (
            <Skeleton key={index} className="h-4 bg-[#EDE7F6]" />
          ))}
        </div>
        <div className="divide-y divide-[#F2F2F2]">
          {Array.from({ length: 7 }).map((_, rowIndex) => (
            <div
              key={rowIndex}
              className="grid grid-cols-[48px_1fr_1fr_1fr_100px_1.3fr_100px_1.2fr_110px_120px] gap-4 p-4"
            >
              <Skeleton className="h-5 w-5 rounded-full bg-[#F4E9DA]" />
              {Array.from({ length: 9 }).map((__, cellIndex) => (
                <Skeleton
                  key={cellIndex}
                  className={`h-5 bg-[#F3F3F3] ${cellIndex === 5 ? 'rounded-full' : ''}`}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState('allocation');
  const [adminData, setAdminData] = useState<AdminRealData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    loadAdminRealData()
      .then((data) => {
        if (cancelled) return;
        setAdminData(data);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error(err);
        setError('Unable to load live administrator data. Showing fallback data.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <AppLayout>
      <div className="p-4 sm:p-5 lg:p-6 space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Administrator</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage coordinator allocations, monitor performance, and generate reports</p>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            {loading && (
              <span className="rounded-full bg-[#FCF3FF] px-2.5 py-1 font-medium text-[#644D93]">
                Loading live learner data...
              </span>
            )}
            {!loading && adminData && (
              <span className="rounded-full bg-[#EDFAF3] px-2.5 py-1 font-medium text-[#1A7A4A]">
                Live data: {adminData.learners.length} learners
              </span>
            )}
            {error && (
              <span className="rounded-full bg-[#FFF8EE] px-2.5 py-1 font-medium text-[#80560F]">
                {error}
              </span>
            )}
          </div>
        </div>

        {loading ? (
          <AdminPageSkeleton />
        ) : (
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList>
              <TabsTrigger value="allocation">Allocation</TabsTrigger>
              <TabsTrigger value="performance">Performance</TabsTrigger>
              <TabsTrigger value="reports">Reports</TabsTrigger>
            </TabsList>

            <TabsContent value="allocation">
              <AllocationManager
                learners={adminData?.learners}
                coordinators={adminData?.coordinators}
                initialAssignments={adminData?.assignments}
                lastContactByLearner={adminData?.lastContactByLearner}
                nextFollowUpByLearner={adminData?.nextFollowUpByLearner}
              />
            </TabsContent>
            <TabsContent value="performance">
              <PerformanceDashboard
                coordinators={adminData?.coordinators}
                learners={adminData?.learners}
                assignments={adminData?.assignments}
                contactLogs={adminData?.contactLogs}
                performance={adminData?.performance}
              />
            </TabsContent>
            <TabsContent value="reports">
              <AdminReports
                coordinators={adminData?.coordinators}
                performance={adminData?.performance}
              />
            </TabsContent>
          </Tabs>
        )}
      </div>
    </AppLayout>
  );
}
