# Copyright 2026 Google LLC
# Licensed under the Apache License, Version 2.0

import json
import os
import sqlite3
from datetime import datetime, timedelta

DB_PATH = os.path.join(os.path.dirname(__file__), "creatorflow.db")

# 2026 US Federal Holidays list
HOLIDAYS_2026 = {
    "2026-01-01",
    "2026-01-19",
    "2026-02-16",
    "2026-05-25",
    "2026-06-19",
    "2026-07-03",
    "2026-09-07",
    "2026-10-12",
    "2026-11-11",
    "2026-11-26",
    "2026-11-27",
    "2026-12-25",
}


def add_days(
    start_date: datetime, days_to_add: int, allow_weekends: bool = False
) -> datetime:
    """Helper to add days to a date, optionally skipping weekends and holidays."""
    current_date = start_date
    added = 0

    while added < days_to_add:
        current_date += timedelta(days=1)
        weekday = current_date.weekday()  # 5 = Saturday, 6 = Sunday
        date_str = current_date.strftime("%Y-%m-%d")

        # Check if we should skip weekends
        if not allow_weekends and weekday >= 5:
            continue

        # Check if we should skip federal holidays
        if date_str in HOLIDAYS_2026:
            continue

        added += 1

    return current_date


def get_db_connection():
    """Establishes connection to the SQLite database."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


# ===============================================================
# DATABASE TOOLS (Exposed directly to the ADK Agent)
# ===============================================================


def list_videos() -> str:
    """Lists all videos in the production pipeline and their active sponsors."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT v.id, v.title, v.status, v.hard_deadline, v.ai_disclosure_required, s.name as sponsor_name
        FROM videos v
        LEFT JOIN sponsors s ON v.sponsor_id = s.id;
    """)
    videos = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return json.dumps(videos, indent=2)


def get_video_timeline(video_id: int) -> str:
    """Gets the milestones and schedule for a specific video, sorted chronologically.

    Args:
        video_id: The ID of the video to fetch the timeline for.
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT phase, target_date, actual_date, dependency_offset
        FROM milestones
        WHERE video_id = ?
        ORDER BY target_date ASC;
    """,
        (video_id,),
    )
    milestones = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return json.dumps(milestones, indent=2)


def get_video_details(video_id: int) -> str:
    """Gets overall details for a specific video, including its title, status, hard deadline, and sponsor ID.

    Args:
        video_id: The ID of the video to fetch details for.
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT id, title, status, hard_deadline, sponsor_id
        FROM videos
        WHERE id = ?;
    """,
        (video_id,),
    )
    video = cursor.fetchone()
    conn.close()
    if video:
        return json.dumps(dict(video), indent=2)
    return json.dumps({"error": f"Video with ID {video_id} not found."})


def get_ai_assets(video_id: int) -> str:
    """Lists the generative AI assets logged for a video.

    Args:
        video_id: The ID of the video to check for AI assets.
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT id, type, model_used, c2pa_hash, description
        FROM ai_assets
        WHERE video_id = ?;
    """,
        (video_id,),
    )
    assets = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return json.dumps(assets, indent=2)


def list_sponsors() -> str:
    """Lists all sponsors in the system and their general details."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, name, review_window_days, ai_allowed FROM sponsors;")
    sponsors = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return json.dumps(sponsors, indent=2)


def get_sponsor_details(sponsor_id: int) -> str:
    """Gets contract guidelines and review policies for a specific sponsor.

    Args:
        sponsor_id: The ID of the sponsor.
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT id, name, review_window_days, script_guidelines, ai_allowed
        FROM sponsors
        WHERE id = ?;
    """,
        (sponsor_id,),
    )
    sponsor = cursor.fetchone()
    conn.close()
    if sponsor:
        return json.dumps(dict(sponsor), indent=2)
    return json.dumps({"error": f"Sponsor with ID {sponsor_id} not found."})


def update_milestone_target_date(video_id: int, phase: str, target_date: str) -> str:
    """Updates the target expected completion date of a milestone.

    Args:
        video_id: The ID of the video.
        phase: The milestone phase name (e.g. 'Scripting', 'Filming', 'Editing').
        target_date: The new date string in YYYY-MM-DD format.
    """
    # 1. Format Validation
    try:
        parsed_date = datetime.strptime(target_date, "%Y-%m-%d")
    except ValueError:
        return json.dumps(
            {
                "status": "error",
                "message": f"Invalid date format '{target_date}'. Target date must strictly use YYYY-MM-DD format.",
            }
        )

    # 2. Check for Weekend / Holiday warnings
    warning = None
    weekday = parsed_date.weekday()
    is_weekend = weekday >= 5
    is_holiday = target_date in HOLIDAYS_2026

    if is_weekend or is_holiday:
        reason = "weekend" if is_weekend else "US Federal Holiday"
        warning = (
            f"Caution: Target date {target_date} lands on a {reason}. "
            "This may violate SAG-AFTRA/IATSE standard work hours and "
            "incur overtime rates or delay delivery approvals."
        )

    # 3. Perform SQLite Update
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        UPDATE milestones
        SET target_date = ?
        WHERE video_id = ? AND phase = ?;
    """,
        (target_date, video_id, phase),
    )
    rows_affected = cursor.rowcount
    conn.commit()
    conn.close()

    if rows_affected == 0:
        return json.dumps(
            {
                "status": "error",
                "message": f"Milestone phase '{phase}' not found for Video ID {video_id}.",
            }
        )

    result = {
        "status": "success",
        "message": f"Updated {phase} milestone to {target_date}.",
    }
    if warning:
        result["warning"] = warning

    return json.dumps(result, indent=2)


def add_ai_asset(
    video_id: int,
    asset_type: str,
    model_used: str,
    description: str,
    c2pa_hash: str | None = None,
) -> str:
    """Logs a new generative AI asset used in the video production.

    Args:
        video_id: The ID of the video.
        asset_type: The type of asset (e.g., 'Voiceover', 'Video', 'B-roll', 'Image').
        model_used: The AI engine name (e.g., 'Suno', 'Midjourney', 'ElevenLabs').
        description: A short description of the asset.
        c2pa_hash: Cryptographic provenance hash (C2PA) or None if missing.
    """
    conn = get_db_connection()
    cursor = conn.cursor()

    try:
        cursor.execute(
            """
            INSERT INTO ai_assets (video_id, type, model_used, description, c2pa_hash)
            VALUES (?, ?, ?, ?, ?);
        """,
            (video_id, asset_type, model_used, description, c2pa_hash),
        )
        conn.commit()
        conn.close()
        return json.dumps(
            {"status": "success", "message": "AI Asset logged successfully."}
        )
    except sqlite3.Error as e:
        conn.close()
        return json.dumps({"status": "error", "message": f"Database error: {e!s}"})


def recalculate_dates_ripple(
    video_id: int, start_phase: str, new_start_date: str, allow_weekends: bool = False
) -> str:
    """Recalculates and ripples dates for all milestones of a video when one shifts.

    Args:
        video_id: The ID of the video to update.
        start_phase: The name of the milestone phase that changed (e.g. 'Filming').
        new_start_date: The new date for the start phase (YYYY-MM-DD).
        allow_weekends: Set to True to allow scheduling on Saturdays and Sundays.
    """
    try:
        datetime.strptime(new_start_date, "%Y-%m-%d")
    except ValueError:
        return json.dumps(
            {
                "status": "error",
                "message": f"Invalid date format '{new_start_date}'. Must be YYYY-MM-DD.",
            }
        )

    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute(
        """
        SELECT phase, target_date, dependency_offset
        FROM milestones
        WHERE video_id = ?;
    """,
        (video_id,),
    )
    rows = cursor.fetchall()

    if not rows:
        conn.close()
        return json.dumps(
            {
                "status": "error",
                "message": f"No milestones found for Video ID {video_id}.",
            }
        )

    milestones = [
        {
            "phase": r["phase"],
            "target_date": r["target_date"],
            "dependency_offset": r["dependency_offset"],
        }
        for r in rows
    ]
    milestones.sort(key=lambda m: m["target_date"])

    start_index = -1
    for idx, m in enumerate(milestones):
        if m["phase"].strip().lower() == start_phase.strip().lower():
            start_index = idx
            break

    if start_index == -1:
        conn.close()
        available_phases = [m["phase"] for m in milestones]
        return json.dumps(
            {
                "status": "error",
                "message": f"Phase '{start_phase}' not found. Available phases: {available_phases}",
            }
        )

    milestones[start_index]["target_date"] = new_start_date

    for i in range(start_index + 1, len(milestones)):
        offset = milestones[i]["dependency_offset"]
        previous_date_str = milestones[i - 1]["target_date"]
        previous_date = datetime.strptime(previous_date_str, "%Y-%m-%d")

        new_date = add_days(previous_date, offset, allow_weekends=allow_weekends)
        milestones[i]["target_date"] = new_date.strftime("%Y-%m-%d")

    warnings_list = []
    for m in milestones:
        cursor.execute(
            """
            UPDATE milestones
            SET target_date = ?
            WHERE video_id = ? AND phase = ?;
        """,
            (m["target_date"], video_id, m["phase"]),
        )

        check_date = datetime.strptime(m["target_date"], "%Y-%m-%d")
        is_weekend = check_date.weekday() >= 5
        is_holiday = m["target_date"] in HOLIDAYS_2026

        if is_weekend or is_holiday:
            reason = "weekend" if is_weekend else "US Federal Holiday"
            warnings_list.append(
                f"Milestone '{m['phase']}' scheduled for {m['target_date']} lands on a {reason}."
            )

    conn.commit()
    conn.close()

    result = {
        "status": "success",
        "message": f"Schedule recalculated and saved starting from '{start_phase}'.",
        "new_timeline": milestones,
    }
    if warnings_list:
        result["warnings"] = warnings_list

    return json.dumps(result, indent=2)
