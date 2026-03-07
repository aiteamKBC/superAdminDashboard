import { useState } from 'react';
import AppLayout from '@/components/AppLayout';
import { mockEmailTemplates, mockLearners } from '@/data/mockData';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Mail, Send, Users, Edit, Eye, Clock } from 'lucide-react';

const kpiLabels: Record<string, string> = {
  'missed-session': 'Missed Session',
  'review-due': 'Review Due',
  'coaching-due': 'Coaching Due',
  'otj-behind': 'OTJ Behind',
};

export default function EmailCentre() {
  const [selectedTemplate, setSelectedTemplate] = useState(mockEmailTemplates[0]);
  const [subject, setSubject] = useState(selectedTemplate.subject);
  const [body, setBody] = useState(selectedTemplate.body);
  const [copyLM, setCopyLM] = useState(false);
  const [copyHR, setCopyHR] = useState(false);

  const recipientCount = mockLearners
    .filter(l => l.status === 'Active' && l.riskCategories.includes(selectedTemplate.kpiCategory))
    .length;

  return (
    <AppLayout>
      <div className="p-6 max-w-6xl">
        <h2 className="text-xl font-semibold text-foreground mb-1">Email Centre</h2>
        <p className="text-sm text-muted-foreground mb-6">Send targeted emails to learners by risk category using pre-built templates.</p>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Template list */}
          <div className="space-y-3">
            <p className="text-sm font-medium text-foreground">Templates</p>
            {mockEmailTemplates.map(t => (
              <Card
                key={t.id}
                className={`p-4 cursor-pointer transition-all ${
                  selectedTemplate.id === t.id ? 'ring-2 ring-ring' : 'hover:shadow-sm'
                }`}
                onClick={() => { setSelectedTemplate(t); setSubject(t.subject); setBody(t.body); }}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-medium text-foreground">{t.name}</p>
                    <Badge variant="outline" className="text-[10px] mt-1">{kpiLabels[t.kpiCategory]}</Badge>
                  </div>
                  <Mail className="w-4 h-4 text-muted-foreground shrink-0" />
                </div>
              </Card>
            ))}
          </div>

          {/* Editor */}
          <div className="lg:col-span-2 space-y-4">
            <Card className="p-5 space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-foreground flex items-center gap-2"><Edit className="w-4 h-4" /> Edit Template</p>
                <Button size="sm" variant="ghost" className="gap-1.5 text-muted-foreground"><Eye className="w-3.5 h-3.5" /> Preview</Button>
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground">Subject</label>
                <Input value={subject} onChange={e => setSubject(e.target.value)} className="mt-1" />
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground">Body</label>
                <Textarea value={body} onChange={e => setBody(e.target.value)} rows={12} className="mt-1 font-mono text-xs" />
              </div>

              <div className="flex flex-wrap gap-1.5">
                <p className="text-xs text-muted-foreground w-full mb-1">Available merge fields:</p>
                {selectedTemplate.mergeFields.map(f => (
                  <Badge key={f} variant="secondary" className="text-[10px] font-mono">{`{{${f}}}`}</Badge>
                ))}
              </div>
            </Card>

            {/* Send options */}
            <Card className="p-5 space-y-4">
              <p className="text-sm font-medium text-foreground">Send Options</p>

              <div className="flex items-center gap-4 text-sm">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-muted-foreground" />
                  <span className="font-semibold text-foreground">{recipientCount}</span>
                  <span className="text-muted-foreground">recipients in "{kpiLabels[selectedTemplate.kpiCategory]}"</span>
                </div>
              </div>

              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={copyLM} onCheckedChange={v => setCopyLM(!!v)} />
                  <span className="text-muted-foreground">Copy Line Manager</span>
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={copyHR} onCheckedChange={v => setCopyHR(!!v)} />
                  <span className="text-muted-foreground">Copy HR Manager</span>
                </label>
              </div>

              <div className="flex gap-3">
                <Button className="gap-1.5"><Send className="w-3.5 h-3.5" /> Send Now</Button>
                <Button variant="outline" className="gap-1.5"><Clock className="w-3.5 h-3.5" /> Schedule</Button>
              </div>

              <p className="text-xs text-muted-foreground">
                ⚠️ You are about to send to {recipientCount} learner{recipientCount !== 1 ? 's' : ''}. A confirmation dialog will appear before sending.
              </p>
            </Card>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
