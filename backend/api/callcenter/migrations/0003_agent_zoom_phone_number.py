from django.core.validators import RegexValidator
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('callcenter', '0002_caseticket_evidence_after')]

    operations = [
        migrations.AddField(
            model_name='agent',
            name='zoom_phone_number',
            field=models.CharField(blank=True, max_length=16, validators=[
                RegexValidator(r'^\+[1-9][0-9]{6,14}$', 'Use the assigned Zoom number in E.164 format.'),
            ]),
        ),
    ]
