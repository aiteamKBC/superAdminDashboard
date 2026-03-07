import { useState } from 'react';
import AppLayout from '@/components/AppLayout';
import { defaultThresholds } from '@/data/mockData';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Save, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';

export default function SettingsPage() {
  const [settings, setSettings] = useState(defaultThresholds);

  const update = (key: keyof typeof settings, value: any) => {
    setSettings(s => ({ ...s, [key]: value }));
  };

  const handleSave = () => {
    toast.success('Settings saved successfully');
  };

  const handleReset = () => {
    setSettings(defaultThresholds);
    toast.info('Settings reset to defaults');
  };

  return (
    <AppLayout>
      <div className="p-6 max-w-3xl space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-foreground">Settings</h2>
            <p className="text-sm text-muted-foreground">Configure thresholds, KPI rules, and field mappings.</p>
          </div>
          <Badge variant="outline" className="text-xs">Admin Only</Badge>
        </div>

        {/* Progress Review */}
        <Card className="p-5 space-y-4">
          <h3 className="text-sm font-semibold text-foreground">Progress Review Settings</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Review Cycle (weeks)</label>
              <Input
                type="number"
                value={settings.progressReviewCycleWeeks}
                onChange={e => update('progressReviewCycleWeeks', parseInt(e.target.value) || 0)}
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">"Due Soon" Window (days)</label>
              <Input
                type="number"
                value={settings.progressReviewDueSoonDays}
                onChange={e => update('progressReviewDueSoonDays', parseInt(e.target.value) || 0)}
                className="mt-1"
              />
            </div>
          </div>
        </Card>

        {/* Monthly Meeting */}
        <Card className="p-5 space-y-4">
          <h3 className="text-sm font-semibold text-foreground">Monthly Coaching Meeting Settings</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Meeting Cycle (weeks)</label>
              <Input
                type="number"
                value={settings.monthlyMeetingCycleWeeks}
                onChange={e => update('monthlyMeetingCycleWeeks', parseInt(e.target.value) || 0)}
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">"Due Soon" Window (days)</label>
              <Input
                type="number"
                value={settings.monthlyMeetingDueSoonDays}
                onChange={e => update('monthlyMeetingDueSoonDays', parseInt(e.target.value) || 0)}
                className="mt-1"
              />
            </div>
          </div>
        </Card>

        {/* OTJ */}
        <Card className="p-5 space-y-4">
          <h3 className="text-sm font-semibold text-foreground">Off-the-Job Hours</h3>
          <div className="max-w-xs">
            <label className="text-xs font-medium text-muted-foreground">Behind Threshold (%)</label>
            <Input
              type="number"
              value={settings.otjBehindThreshold}
              onChange={e => update('otjBehindThreshold', parseInt(e.target.value) || 0)}
              className="mt-1"
            />
          </div>
        </Card>

        {/* Missed Session Statuses */}
        <Card className="p-5 space-y-4">
          <h3 className="text-sm font-semibold text-foreground">Missed Session Statuses</h3>
          <p className="text-xs text-muted-foreground">Select which session statuses count as "missed".</p>
          <div className="flex flex-wrap gap-2">
            {['Missed', 'No Show', 'Cancelled by learner late', 'Cancelled by provider'].map(s => {
              const active = settings.missedSessionStatuses.includes(s);
              return (
                <Badge
                  key={s}
                  variant={active ? 'default' : 'outline'}
                  className="cursor-pointer text-xs"
                  onClick={() => {
                    update('missedSessionStatuses',
                      active
                        ? settings.missedSessionStatuses.filter(x => x !== s)
                        : [...settings.missedSessionStatuses, s]
                    );
                  }}
                >
                  {s}
                </Badge>
              );
            })}
          </div>
        </Card>

        {/* Break in Learning */}
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Include "Break in Learning"</h3>
              <p className="text-xs text-muted-foreground">Include learners with "Break in Learning" status in KPI calculations.</p>
            </div>
            <Switch
              checked={settings.includeBreakInLearning}
              onCheckedChange={v => update('includeBreakInLearning', v)}
            />
          </div>
        </Card>

        <Separator />

        <div className="flex gap-3">
          <Button onClick={handleSave} className="gap-1.5"><Save className="w-3.5 h-3.5" /> Save Settings</Button>
          <Button variant="outline" onClick={handleReset} className="gap-1.5"><RotateCcw className="w-3.5 h-3.5" /> Reset to Defaults</Button>
        </div>
      </div>
    </AppLayout>
  );
}
