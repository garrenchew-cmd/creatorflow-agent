# Copyright 2026 Google LLC
# Licensed under the Apache License, Version 2.0

import json
import os
import sqlite3
from datetime import datetime

from mcp.server.fastmcp import FastMCP

# Initialize FastMCP Server
mcp = FastMCP("CreatorFlow Data Server")

DB_PATH = os.path.join(os.path.dirname(__file__), "creatorflow.db")

# 2026 US Federal Holidays list for union compliance
HOLIDAYS_2026 = {
    "2026-01-01",  # New Year's Day
    "2026-01-19",  # Martin Luther King Jr. Day
    "2026-02-16",  # Washington's Birthday (Presidents' Day)
    "2026-05-25",  # Memorial Day
    "2026-06-19",  # Juneteenth National Independence Day
    "2026-07-03",  # Independence Day (Observed)
    "2026-09-07",  # Labor Day
    "2026-10-12",  # Columbus Day
    "2026-11-11",  # Veterans Day
    "2026-11-26",  # Thanksgiving Day
    "2026-11-27",  # Day after Thanksgiving (Common union holiday)
    "2026-12-25",  # Christmas Day
}


def get_db_connection():
    """Establishes a connection to the SQLite database."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


# ===============================================================
# MCP TOOLS
# ===============================================================


@mcp.tool()
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


@mcp.tool()
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


@mcp.tool()
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


@mcp.tool()
def list_sponsors() -> str:
    """Lists all sponsors in the system and their general details."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, name, review_window_days, ai_allowed FROM sponsors;")
    sponsors = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return json.dumps(sponsors, indent=2)


@mcp.tool()
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


@mcp.tool()
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
    weekday = parsed_date.weekday()  # Monday is 0, Sunday is 6
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


@mcp.tool()
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
        description: A brief summary of how the asset was used.
        c2pa_hash: Cryptographic provenance hash (optional).
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            INSERT INTO ai_assets (video_id, type, model_used, c2pa_hash, description)
            VALUES (?, ?, ?, ?, ?);
        """,
            (video_id, asset_type, model_used, c2pa_hash, description),
        )
        conn.commit()
        conn.close()
        return json.dumps(
            {"status": "success", "message": "AI Asset logged successfully."}
        )
    except sqlite3.Error as e:
        conn.close()
        return json.dumps({"status": "error", "message": f"Database error: {e!s}"})


if __name__ == "__main__":
    mcp.run()
