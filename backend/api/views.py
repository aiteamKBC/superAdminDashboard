from django.shortcuts import render

# Create your views here.
import json
from django.http import JsonResponse
from django.db import connection, connections
from django.views.decorators.csrf import csrf_exempt
from datetime import datetime, date

def current_db_info(request):
    with connection.cursor() as cursor:
        cursor.execute("SELECT current_database(), current_schema()")
        row = cursor.fetchone()

    return JsonResponse({
        "database": row[0],
        "schema": row[1],
    })

def parse_date_safe(value):
    if not value:
        return None

    value = str(value).strip()
    if not value or value.upper() == "N/A":
        return None

    formats = [
        "%Y-%m-%d",
        "%d-%m-%Y",
        "%d/%m/%Y",
        "%Y/%m/%d",
        "%d-%m-%y",
        "%d/%m/%y",
    ]

    for fmt in formats:
        try:
            return datetime.strptime(value, fmt).date()
        except Exception:
            continue

    return None


def is_completed_status(status_value):
    s = str(status_value or "").strip().lower()
    return "completed" in s


def progress_review_summary(request):
    with connections["neon"].cursor() as cursor:
        cursor.execute("""
            SELECT
                "ID",
                "FullName",
                "Email",
                "Group",
                "CaseOwner",
                "Last Progress Review",
                "Next Review (Status)",
                "Review Planned Date1", "Review Status1",
                "Review Planned Date2", "Review Status2",
                "Review Planned Date3", "Review Status3",
                "Review Planned Date4", "Review Status4",
                "Review Planned Date5", "Review Status5",
                "Review Planned Date6", "Review Status6",
                "Review Planned Date7", "Review Status7",
                "Review Planned Date8", "Review Status8",
                "Review Planned Date9", "Review Status9",
                "Review Planned Date10", "Review Status10",
                "Review Planned Date11", "Review Status11",
                "Review Planned Date12", "Review Status12",
                "Review Planned Date13", "Review Status13",
                "Review Planned Date14", "Review Status14",
                "Review Planned Date15", "Review Status15",
                "Review Planned Date16", "Review Status16"
            FROM public.progress_review
        """)
        columns = [col[0] for col in cursor.description]
        raw_rows = [dict(zip(columns, row)) for row in cursor.fetchall()]

    today = date.today()
    results = []

    for row in raw_rows:
        overdue_count = 0

        for i in range(1, 17):
            planned_key = f"Review Planned Date{i}"
            status_key = f"Review Status{i}"

            planned_date = parse_date_safe(row.get(planned_key))
            completed = is_completed_status(row.get(status_key))

            if planned_date and planned_date < today and not completed:
                overdue_count += 1

        if overdue_count <= 0:
            review_status = "Ahead"
        elif overdue_count > 12:
            review_status = "Due"
        elif overdue_count > 10:
            review_status = "At Risk"
        else:
            review_status = "Normal"

        results.append({
            "id": row.get("ID"),
            "fullName": row.get("FullName") or "",
            "email": (row.get("Email") or "").strip().lower(),
            "group": row.get("Group") or "",
            "caseOwner": row.get("CaseOwner") or "",
            "lastProgressReview": row.get("Last Progress Review") or "",
            "nextReviewStatus": row.get("Next Review (Status)") or "",
            "overduePrCount": overdue_count,
            "reviewStatus": review_status,
        })

    return JsonResponse(results, safe=False)

def test_kbc_attendance(request):
    with connection.cursor() as cursor:
        cursor.execute("""
            SELECT "Email", "date", "module", "Attendance", "called", "emailed", "resolved", "resolved_at", "note"
            FROM public.kbc_attendance
            ORDER BY "date" DESC
            LIMIT 20
        """)
        rows = cursor.fetchall()

    data = []
    for row in rows:
        data.append({
            "email": row[0],
            "date": row[1].isoformat() if row[1] else None,
            "module": row[2],
            "attendance": row[3],
            "called": bool(row[4]),
            "emailed": bool(row[5]),
            "resolved": bool(row[6]),
            "resolved_at": row[7].isoformat() if row[7] else None,
            "note": row[8] or "",
        })

    return JsonResponse(data, safe=False)


@csrf_exempt
def learner_contact_actions(request):
    if request.method == "GET":
        with connection.cursor() as cursor:
            cursor.execute("""
                SELECT "Email", "date", "module", "called", "emailed", "resolved", "resolved_at", "note"
                FROM public.kbc_attendance
                WHERE "called" = true
                   OR "emailed" = true
                   OR "resolved" = true
                   OR COALESCE("note", '') <> ''
                ORDER BY "date" DESC
                LIMIT 1000
            """)
            rows = cursor.fetchall()

        data = []
        for row in rows:
            email = (row[0] or "").strip().lower()
            date_value = row[1].isoformat() if row[1] else None
            module = row[2] or ""

            data.append({
                "email": email,
                "date": date_value,
                "module": module,
                "called": bool(row[3]),
                "emailed": bool(row[4]),
                "resolved": bool(row[5]),
                "resolved_at": row[6].isoformat() if row[6] else None,
                "note": row[7] or "",
                "contact_key": f"{email}||{date_value}||{module}",
            })

        return JsonResponse(data, safe=False)

    if request.method == "PATCH":
        try:
            body = json.loads(request.body.decode("utf-8"))

            email = str(body.get("email", "")).strip().lower()
            date_value = body.get("date")
            module = str(body.get("module", "")).strip()
            called = bool(body.get("called", False))
            emailed = bool(body.get("emailed", False))
            resolved = bool(body.get("resolved", False))
            note = str(body.get("note", "")).strip()

            if not email or not date_value or not module:
                return JsonResponse(
                    {"error": "email, date and module are required"},
                    status=400,
                )

            with connection.cursor() as cursor:
                cursor.execute("""
                    UPDATE public.kbc_attendance
                    SET "called" = %s,
                        "emailed" = %s,
                        "resolved" = %s,
                        "note" = %s,
                        "resolved_at" = CASE
                            WHEN %s = true THEN NOW()
                            ELSE NULL
                        END
                    WHERE lower("Email") = lower(%s)
                      AND "date" = %s
                      AND "module" = %s
                    RETURNING "Email", "date", "module", "called", "emailed", "resolved", "resolved_at", "note"
                """, [called, emailed, resolved, note, resolved, email, date_value, module])

                row = cursor.fetchone()

            if not row:
                return JsonResponse({"error": "Attendance row not found"}, status=404)

            return JsonResponse({
                "email": row[0],
                "date": row[1].isoformat() if row[1] else None,
                "module": row[2],
                "called": bool(row[3]),
                "emailed": bool(row[4]),
                "resolved": bool(row[5]),
                "resolved_at": row[6].isoformat() if row[6] else None,
                "note": row[7] or "",
                "contact_key": f"{(row[0] or '').strip().lower()}||{row[1].isoformat() if row[1] else None}||{row[2] or ''}",
            })

        except Exception as e:
            return JsonResponse({"error": str(e)}, status=500)

    return JsonResponse({"error": "Method not allowed"}, status=405)

    