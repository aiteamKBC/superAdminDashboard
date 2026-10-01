import json
import time

from django.core.management.base import BaseCommand, CommandError
from django.db import close_old_connections

from api.callcenter.cycle import run_cycle


class Command(BaseCommand):
    help = 'Poll Zoom, build Call Centre cases and evaluate evidence/reminders. Email defaults to dry-run.'

    def add_arguments(self, parser):
        parser.add_argument('--loop', action='store_true')
        parser.add_argument('--interval', type=int, default=300)
        parser.add_argument('--skip-zoom', action='store_true')
        parser.add_argument('--skip-ai', action='store_true')
        parser.add_argument('--skip-emails', action='store_true')

    def handle(self, *args, **options):
        if options['interval'] < 60:
            raise CommandError('Interval must be at least 60 seconds.')
        try:
            while True:
                close_old_connections()
                result = run_cycle(skip_zoom=options['skip_zoom'], skip_ai=options['skip_ai'], skip_emails=options['skip_emails'])
                self.stdout.write(json.dumps(result))
                if not options['loop']:
                    break
                time.sleep(options['interval'])
        except KeyboardInterrupt:
            self.stdout.write('Call Centre cycle stopped.')
