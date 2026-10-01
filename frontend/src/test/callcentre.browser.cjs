/* Browser-only fixtures. All API traffic is intercepted; no production writes or calls. */
const {chromium} = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const baseUrl = process.env.CALLCENTRE_TEST_URL || 'http://127.0.0.1:5173';

const now = new Date().toISOString();
const base = {
  id: 1, source_type: 'attendance', source_id: 1, learner_email: 'learner@example.test',
  issue_name: 'Customer Journey Optimisation', issue_date: '2026-09-28',
  learner_name: 'Alexandra Montgomery', learner_phone: '+447700900123', coach: 'Olivia',
  organisation: 'Example Employer', programme: 'Business Administration', manager_name: 'Example Manager',
  manager_email: 'manager@example.test', status: 'new', risk: 'red', claimed_by: null, claimed_agent_id: null,
  last_actor: 'System', last_action_at: now, attempts: 1, next_followup_at: null, due_at: now,
  sla_breached: true, sla_days_overdue: 2, learner_days_overdue: 8, misses: 3, booking_at: null,
  ai_summary: '', ai_confidence: null, resolution_option: '', resolved_at: null, resolved_by: '',
  archived: false, created_at: now, priority_why: 'Red risk; overdue SLA; 3 missed sessions', source_data: {},
};

async function run() {
  const browser = await chromium.launch({channel: 'chrome', headless: true});
  try {
    for (const viewport of [{width: 1440, height: 1000}, {width: 390, height: 844}]) {
      const page = await browser.newPage({viewport});
      const errors = [], mutations = [], requests = [];
      let zoomReportLoads = 0;
      let tickets = {
        1: {...base},
        2: {...base, id: 2, source_type: 'mcm', issue_name: 'MCM', issue_date: null, priority_why: 'MCM overdue'},
        3: {...base, id: 3, source_type: 'pr', issue_name: 'Progress review', issue_date: null, status: 'ai_suggested_close', ai_summary: 'Attendance evidence is now complete.', ai_confidence: 0.91},
        4: {...base, id: 4, source_type: 'otj', issue_name: 'OTJ', issue_date: null, status: 'resolved', resolved_at: now, resolved_by: 'agent'},
      };
      page.on('pageerror', e => errors.push(e.message));
      await page.route('**/api/**', async route => {
        const url = new URL(route.request().url());
        const pathname = url.pathname;
        requests.push(url.pathname + url.search);
        let data = {};
        if (pathname === '/api/auth/session/') data = {authenticated: true, user: {id: 1, username: 'liza-test', fullName: 'Liza', isStaff: false}};
        else if (pathname === '/api/callcentre/config/') data = {csrf_token: 'fixture-only', agent_id: null, is_manager: true, is_superuser: true, email_mode: 'dry_run', ai_enabled: false, agents: [{id: 2, display_name: 'Alice', zoom_account: 'office', zoom_phone_number: '+441622958955'}, {id: 1, display_name: 'Liza', zoom_account: 'student', zoom_phone_number: '+441622958454'}], sources: [], cycle: {last_success_at: now}};
        else if (pathname === '/api/callcentre/queue/') {
          const view = url.searchParams.get('view');
          const current = view === 'ai' ? tickets[3] : view === 'history' ? tickets[4] : tickets[1];
          const groupedTickets = view === 'queue' ? [tickets[1], tickets[2]] : [current];
          const q = url.searchParams.get('q') || '';
          const visible = !q || current.learner_name.toLowerCase().includes(q.toLowerCase());
          const pageNumber = Number(url.searchParams.get('page') || 1);
          data = {groups: visible ? [{learner_email: current.learner_email, learner_name: current.learner_name, coach: current.coach, learner_phone: current.learner_phone, tickets: groupedTickets}] : [], total: visible ? 2 : 0, page: pageNumber, has_next: pageNumber === 1, coaches: ['Olivia', 'Nathan']};
        } else if (/\/tickets\/\d+\/$/.test(pathname)) {
          const id = Number(pathname.match(/\/tickets\/(\d+)\//)[1]);
          const ticket = tickets[id];
          const eventPage = Number(url.searchParams.get('event_page') || 1);
          data = {
          ticket, issues: id <= 2 ? [
            {id: 1, source_type: 'attendance', status: tickets[1].status, issue_name: tickets[1].issue_name, issue_date: tickets[1].issue_date},
            {id: 2, source_type: 'mcm', status: tickets[2].status, issue_name: tickets[2].issue_name, issue_date: tickets[2].issue_date},
          ] : [{id, source_type: ticket.source_type, status: ticket.status, issue_name: ticket.issue_name, issue_date: ticket.issue_date}],
          events: [{id: eventPage, kind: eventPage === 1 ? 'zoom_call' : 'note', actor: 'Liza', created_at: now, call_id: eventPage === 1 ? 91 : null, data: {manual: false, page: eventPage}}], has_more_events: eventPage === 1,
          calls: [{call_id: 91, agent: 'Liza', manual: false, result: 'answered', started_at: now, duration_seconds: 125, outcome: ''}],
          emails: [{id: 1, kind: 'initial', status: 'dry_run', mode: 'dry_run', subject: 'KBC follow-up', text: 'Please contact your coach.', error: '', created_at: now}],
          };
        }
        else if (/\/tickets\/\d+\/\w+\/$/.test(pathname)) {
          assert.equal(route.request().method(), 'POST');
          assert.equal(route.request().headers()['x-csrftoken'], 'fixture-only');
          const payload = JSON.parse(route.request().postData() || '{}');
          assert([1, 2].includes(payload.agent_id));
          const match = pathname.match(/\/tickets\/(\d+)\/(\w+)\//);
          const id = Number(match[1]);
          const command = match[2];
          let ticket = tickets[id];
          mutations.push(pathname);
          if (command === 'claim') ticket = {...ticket, status: id === 3 ? 'ai_suggested_close' : 'in_progress', claimed_by: payload.agent_id === 1 ? 'Liza' : 'Alice', claimed_agent_id: payload.agent_id};
          if (command === 'release') ticket = {...ticket, status: 'new', claimed_by: null, claimed_agent_id: null};
          if (command === 'call') ticket = {...ticket, status: 'in_progress', claimed_by: payload.agent_id === 1 ? 'Liza' : 'Alice', claimed_agent_id: payload.agent_id};
          if (command === 'resolve') ticket = {...ticket, status: 'resolved', resolved_by: 'agent', resolved_at: now};
          if (command === 'reopen') ticket = {...ticket, status: 'in_progress', resolved_by: '', resolved_at: null};
          if (command === 'archive') ticket = {...ticket, archived: true};
          if (command === 'reject_ai') ticket = {...ticket, status: 'in_progress', ai_summary: '', ai_confidence: null};
          tickets = {...tickets, [id]: ticket};
          data = command === 'call' ? {ok: true, ticket, zoom_url: '#zoom-call-fixture', tel_url: '#phone-fixture'} : {ok: true, ticket};
        } else if (pathname === '/api/zoom/calls/91/recordings/') data = {recordings: [{id: 5, recording_type: 'Automatic', owner_name: 'Liza', duration_seconds: 125, transcript_status: 'ready'}]};
        else if (pathname === '/api/zoom/recordings/5/transcript/') data = {id: 5, status: 'ready', text: 'Example learner transcript for an isolated browser test.', transcript: {}, error: ''};
        else if (pathname === '/api/callcentre/satisfaction/') data = {surveys: [{id: 1, ticket_id: 1, manager_email: 'manager@example.test', organisation: 'Example Employer', quarter: '2026-Q3', score: 2, comment: 'More timely updates, please.', ticket__status: 'resolved', ticket__escalated: true}], has_next: Number(url.searchParams.get('page') || 1) === 1, trend: [{quarter: '2026-Q3', organisation: 'Example Employer', average: 2, responses: 1}]};
        else if (pathname === '/api/callcentre/performance/') data = {agents: ['Liza', 'Alice'].map((name, i) => ({
          id: i + 1, name, account: i ? 'office' : 'student', zoom_phone_number: i ? '' : '+447700900111',
          daily_target_minutes: 180, calls: i ? 0 : 8, answered: i ? 0 : 6, not_answered: i ? 0 : 2,
          seconds: i ? 0 : 4200, missing_duration: i ? 0 : 1, unique_learners: i ? 0 : 5, resolved: 3,
          pending: 4, sla_breaches: i, emails: 2, reminders: 1,
          sync: {last_success_at: i ? null : now, error: i ? 'Zoom Phone is not enabled for this account (Zoom 2031).' : '', recordings_error: ''},
          daily: [{date: now.slice(0, 10), calls: i ? 0 : 8, answered: i ? 0 : 6, not_answered: i ? 0 : 2,
            seconds: i ? 0 : 4200, missing_duration: i ? 0 : 1, first_call: i ? null : now, last_call: i ? null : now, gaps_unknown: false, gaps: []}],
        })), resolutions: {agent: 6, ai: 0, system: 2}, unclaimed_breaches: 1};
        else if (pathname === '/api/zoom/calls/') {
          zoomReportLoads += 1;
          if (zoomReportLoads > 1) await new Promise(resolve => setTimeout(resolve, 250));
          data = {
          timezone: 'Europe/London',
          accounts: [
            {key: 'student', label: 'Student', configured: true, last_success_at: now, syncing: false, error: '', calls: 8, answered: 6, not_answered: 2, other: 0, duration_seconds: 4200, answered_duration_seconds: 3900, missing_duration: 0},
            {key: 'office', label: 'Office (Accountant)', configured: true, last_success_at: now, syncing: false, error: '', calls: 12, answered: 10, not_answered: 2, other: 0, duration_seconds: 7200, answered_duration_seconds: 6600, missing_duration: 0},
          ],
          totals: {calls: 20, answered: 16, not_answered: 4, other: 0, duration_seconds: 11400, answered_duration_seconds: 10500, missing_duration: 0},
          calls: [{
            id: 91, source_account: 'office', direction: 'outbound', caller_number: '+441622958955',
            caller_name: 'IBIS Consultancy', caller_email: '', callee_number: '+447700900123',
            callee_name: '', contact_name: 'Alexandra Montgomery', contact_email: 'learner@example.test',
            contact_role: 'learner', started_at: now, duration_seconds: 125, result: 'answered', raw_result: 'connected',
          }], daily: [], page: 1, page_size: 50, total_records: 20, has_next: false,
          };
        }
        else if (pathname === '/api/zoom/transcripts/') data = {
          timezone: 'Europe/London', summary: {total: 2, ready: 1, pending: 0, disabled: 1, unavailable: 0, error: 0},
          accounts: [
            {key: 'student', label: 'Student', total: 1, ready: 1, pending: 0, disabled: 0, unavailable: 0, error: 0},
            {key: 'office', label: 'Office (Accountant)', total: 1, ready: 0, pending: 0, disabled: 1, unavailable: 0, error: 0},
          ],
          records: [
            {id: 5, source_account: 'student', recording_type: 'Automatic', owner_name: 'Liza', started_at: now, duration_seconds: 125, transcript_status: 'ready', transcript_error: '', preview: 'Example learner transcript'},
            {id: 6, source_account: 'office', recording_type: 'Automatic', owner_name: 'Alice', started_at: now, duration_seconds: 220, transcript_status: 'disabled', transcript_error: '', preview: ''},
          ], page: 1, total_records: 2, has_next: false,
        };
        else return route.fulfill({status: 404, contentType: 'application/json', body: JSON.stringify({detail: 'Unmocked endpoint'})});
        await route.fulfill({contentType: 'application/json', body: JSON.stringify(data)});
      });
      await page.goto(baseUrl + '/call-centre');
      await page.getByRole('button', {name: 'Alexandra Montgomery', exact: true}).waitFor();
      await page.getByLabel('Zoom account').selectOption('2');
      await page.getByLabel('Zoom account').selectOption('1');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      await page.screenshot({path: path.join(os.tmpdir(), `callcentre-${viewport.width}.png`), fullPage: true});
      if (viewport.width === 1440) {
        await page.getByRole('button', {name: 'Refresh Call Centre'}).click();
        await page.getByLabel('Search learners').fill('Alexandra');
        await page.getByLabel('Coach').selectOption('Olivia');
        await page.getByLabel('Category').selectOption('attendance');
        await page.getByLabel('Status', {exact: true}).selectOption('new');
        await page.getByLabel('Claim status').selectOption('no');
        await page.getByLabel('Due state').selectOption('overdue');
        await page.waitForTimeout(100);
        assert(requests.some(url => url.includes('q=Alexandra')));
        assert(requests.some(url => url.includes('coach=Olivia')));
        assert(requests.some(url => url.includes('source_type=attendance')));
        assert(requests.some(url => url.includes('status=new')));
        assert(requests.some(url => url.includes('claimed=no')));
        assert(requests.some(url => url.includes('due=overdue')));

        for (const tab of ['Tomorrow', 'Due / Overdue', 'History', 'Queue']) {
          await page.getByRole('tab', {name: tab, exact: true}).click();
          await page.getByRole('button', {name: 'Alexandra Montgomery', exact: true}).waitFor();
        }
        await page.getByRole('button', {name: 'Next page'}).click();
        await page.getByText(/Page 2$/).waitFor();
        await page.getByRole('button', {name: 'Previous page'}).click();
        await page.getByText(/Page 1$/).waitFor();

        await page.getByRole('button', {name: 'Call Alexandra Montgomery'}).click();
        await page.getByRole('heading', {name: 'Alexandra Montgomery'}).waitFor();
        assert(mutations.some(url => url.endsWith('/call/')));
        await page.getByRole('button', {name: 'Call in Zoom', exact: true}).click();
        await page.getByRole('dialog').getByRole('link', {name: 'Open Zoom'}).waitFor();
        await page.getByRole('button', {name: 'Release', exact: true}).click();
        await page.getByRole('button', {name: 'Claim', exact: true}).waitFor();
        await page.getByRole('button', {name: 'Claim', exact: true}).click();
        await page.getByRole('button', {name: 'Release', exact: true}).waitFor();

        await page.getByRole('button', {name: 'MCM', exact: true}).click();
        await page.getByRole('dialog').getByText('MCM', {exact: true}).first().waitFor();
        await page.getByRole('button', {name: 'Customer Journey Optimisation - 28 Sept 2026', exact: true}).click();
        await page.getByRole('dialog').getByText('Customer Journey Optimisation - 28 Sept 2026', {exact: true}).first().waitFor();

        await page.getByRole('button', {name: 'View transcript', exact: true}).click();
        await page.getByText('Example learner transcript for an isolated browser test.').waitFor();
        await page.getByRole('button', {name: 'Refresh recordings'}).click();
        await page.getByText('Example learner transcript for an isolated browser test.').waitFor();
        await page.getByRole('button', {name: 'View transcript for recording 5'}).click();
        const downloadPromise = page.waitForEvent('download');
        await page.getByRole('button', {name: 'Download transcript'}).click();
        assert.equal((await downloadPromise).suggestedFilename(), 'zoom-transcript-5.txt');
        await page.screenshot({path: path.join(os.tmpdir(), `callcentre-transcript-${viewport.width}.png`), fullPage: true});
        await page.getByRole('dialog').last().getByRole('button', {name: 'Close', exact: true}).click();

        await page.getByLabel('Confirmed call').selectOption('91');
        await page.getByLabel('Outcome').selectOption('callback');
        assert.equal(await page.getByRole('button', {name: 'Save outcome'}).isDisabled(), true);
        await page.getByLabel('Callback (your device timezone)').fill('2026-10-02T10:30');
        await page.getByRole('button', {name: 'Save outcome'}).click();
        await page.getByLabel('Decision reason or note').fill('Fixture note for the complete button test.');
        await page.getByRole('button', {name: 'Add note'}).click();

        await page.getByRole('button', {name: 'Older', exact: true}).click();
        await page.getByRole('button', {name: 'Newer', exact: true}).click();
        await page.getByText(/KBC follow-up/).click();
        await page.getByText('Please contact your coach.').waitFor();

        await page.getByLabel('Resolution option').selectOption('watch_recording');
        await page.getByLabel('Decision reason or note').fill('Evidence checked before resolving.');
        await page.getByRole('button', {name: 'Resolve', exact: true}).click();
        await page.getByRole('button', {name: 'Reopen', exact: true}).waitFor();
        await page.getByLabel('Decision reason or note').fill('Reopen reason for the fixture test.');
        await page.getByRole('button', {name: 'Reopen', exact: true}).click();
        await page.getByRole('button', {name: 'Resolve', exact: true}).waitFor();
        await page.getByLabel('Decision reason or note').fill('Resolve again to test archive.');
        await page.getByRole('button', {name: 'Resolve', exact: true}).click();
        await page.getByRole('button', {name: 'Archive case'}).click();
        await page.getByRole('button', {name: 'Archive case'}).waitFor({state: 'detached'});
        await page.getByRole('dialog').getByRole('button', {name: 'Close', exact: true}).click();

        await page.getByRole('tab', {name: 'AI suggestions', exact: true}).click();
        await page.getByRole('button', {name: 'Alexandra Montgomery', exact: true}).click();
        await page.getByRole('button', {name: 'Reject suggestion', exact: true}).waitFor();
        await page.getByRole('button', {name: 'Reject suggestion', exact: true}).click();
        await page.getByRole('button', {name: 'Reject suggestion', exact: true}).waitFor({state: 'detached'});
        await page.getByRole('dialog').getByRole('button', {name: 'Close', exact: true}).click();

        await page.getByRole('tab', {name: 'Satisfaction', exact: true}).click();
        await page.getByText('More timely updates, please.').waitFor();
        await page.getByRole('button', {name: 'manager@example.test'}).click();
        await page.getByRole('heading', {name: 'Alexandra Montgomery'}).waitFor();
        await page.getByRole('dialog').getByRole('button', {name: 'Close', exact: true}).click();
        await page.getByRole('button', {name: 'Next page'}).click();
        await page.getByText(/^Page 2$/).waitFor();
        await page.getByRole('button', {name: 'Previous page'}).click();
      } else {
        await page.getByRole('button', {name: 'Alexandra Montgomery', exact: true}).click();
        await page.getByRole('heading', {name: 'Alexandra Montgomery'}).waitFor();
        await page.getByRole('button', {name: 'View transcript', exact: true}).click();
        await page.getByText('Example learner transcript for an isolated browser test.').waitFor();
        await page.screenshot({path: path.join(os.tmpdir(), `callcentre-transcript-${viewport.width}.png`), fullPage: true});
        await page.getByRole('dialog').last().getByRole('button', {name: 'Close', exact: true}).click();
        await page.getByLabel('Decision reason or note').fill('Reviewed attendance evidence with coach.');
        await page.getByRole('button', {name: 'Resolve', exact: true}).click();
        await page.getByRole('button', {name: 'Reopen', exact: true}).waitFor();
        await page.getByRole('dialog').getByRole('button', {name: 'Close', exact: true}).click();
        await page.getByRole('tab', {name: 'Satisfaction', exact: true}).click();
        await page.getByText('More timely updates, please.').waitFor();
      }
      await page.goto(baseUrl + '/activity-report');
      await page.getByText('Alexandra Montgomery', {exact: true}).waitFor();
      await page.getByText('Learner', {exact: true}).waitFor();
      const reportRefresh = page.getByRole('button', {name: 'Refresh report'});
      await reportRefresh.click();
      await page.waitForFunction(() => (document.querySelector('[aria-label="Refresh report"]'))?.hasAttribute('disabled'));
      assert.equal(await page.getByText('Alexandra Montgomery', {exact: true}).isVisible(), true);
      await page.waitForFunction(() => !(document.querySelector('[aria-label="Refresh report"]'))?.hasAttribute('disabled'));
      await page.getByRole('button', {name: 'Account hours', exact: true}).click();
      await page.getByRole('heading', {name: 'Account call hours', exact: true}).waitFor();
      assert.equal(await page.getByRole('dialog').getByText('Student', {exact: true}).count(), 1);
      assert.equal(await page.getByRole('dialog').getByText('Office (Accountant)', {exact: true}).count(), 1);
      await page.screenshot({path: path.join(os.tmpdir(), `account-hours-${viewport.width}.png`), fullPage: true});
      await page.getByRole('dialog').getByRole('button', {name: 'Close', exact: true}).click();
      await page.getByRole('button', {name: 'All transcripts', exact: true}).click();
      await page.getByRole('heading', {name: 'All transcripts', exact: true}).waitFor();
      await page.getByRole('dialog').getByRole('button', {name: /Liza/}).click();
      await page.getByRole('dialog').getByText('Example learner transcript for an isolated browser test.').waitFor();
      await page.screenshot({path: path.join(os.tmpdir(), `all-transcripts-${viewport.width}.png`), fullPage: true});
      await page.getByRole('dialog').getByRole('button', {name: 'Close', exact: true}).click();
      await page.getByRole('tab', {name: 'Agent performance'}).click();
      await page.getByRole('heading', {name: 'Call results'}).waitFor();
      assert.match(await page.getByRole('columnheader').filter({hasText: 'Liza'}).innerText(), /student[\s\S]*\+447700900111/i);
      assert.match(await page.getByRole('columnheader').filter({hasText: 'Alice'}).innerText(), /office[\s\S]*Number unavailable/i);
      assert.equal(await page.getByRole('row').filter({has: page.getByRole('rowheader', {name: 'Calls', exact: true})}).getByRole('cell').nth(1).innerText(), '--');
      assert.equal(await page.getByRole('row').filter({has: page.getByRole('rowheader', {name: 'Resolved by agent', exact: true})}).getByRole('cell').nth(1).innerText(), '3');
      await page.screenshot({path: path.join(os.tmpdir(), `agent-performance-${viewport.width}.png`), fullPage: true});
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      assert(mutations.some(url => url.endsWith('/claim/')));
      assert(mutations.some(url => url.endsWith('/resolve/')));
      if (viewport.width === 1440) {
        for (const command of ['call', 'release', 'outcome', 'note', 'reopen', 'archive', 'reject_ai']) {
          assert(mutations.some(url => url.endsWith(`/${command}/`)), `Missing ${command} action`);
        }
        for (const view of ['tomorrow', 'due', 'ai', 'history']) {
          assert(requests.some(url => url.includes(`view=${view}`)), `Missing ${view} tab request`);
        }
      }
      assert.deepEqual(errors, []);
      console.log(`PASS ${viewport.width}px: Call Centre controls, transcript, workflow, survey, activity dialogs, and performance; no overflow or JS errors.`);
      await page.close();
    }
  } finally {await browser.close();}
}
run().catch(e => {console.error(e); process.exitCode = 1;});
