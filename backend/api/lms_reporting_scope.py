"""Shared LMS population used by the admin and marking reports."""

EXCLUDED_COACH_EMAILS = (
    "ahmed.lotfi@kentbusinesscollege.com",
    "olivia.evans@kentbusinesscollege.com",
)

# The staff directory is the authority for coach identity. A profile's free
# text coach name can contain test accounts, teams, or placeholders.
REAL_COACHES_CTE = """
WITH real_coaches AS (
    SELECT DISTINCT ON (lower(btrim("Email")))
        lower(btrim("Email")) AS coach_key,
        btrim("Username") AS coach_name
    FROM enrolment."Staff_users"
    WHERE lower(btrim(COALESCE("Access", ''))) = 'coach'
      AND lower(btrim(COALESCE("Email", ''))) LIKE '%%@kentbusinesscollege.com'
      AND lower(btrim(COALESCE("Username", ''))) !~ 'test|qa|demo|dummy'
      AND lower(btrim("Email")) <> ALL(%s)
    ORDER BY lower(btrim("Email")), id
)
"""

REAL_LEARNER_WHERE = """
NULLIF(btrim(p.full_name), '') IS NOT NULL
AND lower(p.full_name) !~ '(^|[^a-z])(test|demo|dummy)([^a-z]|$)'
AND lower(COALESCE(p.email, '')) NOT LIKE '%%@example.test'
"""

CURRENT_PROGRAMME_STATUSES = ("active", "delivery")
