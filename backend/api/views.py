from django.shortcuts import render

# Create your views here.
import json
from django.http import JsonResponse
from django.db import connection
from django.views.decorators.csrf import csrf_exempt


def test_kbc_attendance(request):
    with connection.cursor() as cursor:
        cursor.execute("""
            SELECT "Email", "date", "module", "Attendance", "called", "emailed"
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
        })

    return JsonResponse(data, safe=False)


@csrf_exempt
def learner_contact_actions(request):
    if request.method == "GET":
        with connection.cursor() as cursor:
            cursor.execute("""
                SELECT "Email", "date", "module", "called", "emailed", "resolved"
FROM public.kbc_attendance
WHERE "called" = true OR "emailed" = true OR "resolved" = true
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
        "resolved_at" = CASE
            WHEN %s = true THEN NOW()
            ELSE NULL
        END
    WHERE lower("Email") = lower(%s)
      AND "date" = %s
      AND "module" = %s
    RETURNING "Email", "date", "module", "called", "emailed", "resolved"
""", [called, emailed, resolved, resolved, email, date_value, module])

                row = cursor.fetchone()

            if not row:
                return JsonResponse({"error": "Attendance row not found"}, status=404)

            return JsonResponse({
                "email": row[0],
                "date": row[1].isoformat() if row[1] else None,
                "module": row[2],
                "called": bool(row[3]),
                "emailed": bool(row[4]),
            })

        except Exception as e:
            return JsonResponse({"error": str(e)}, status=500)

    return JsonResponse({"error": "Method not allowed"}, status=405)