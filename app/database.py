# Copyright 2026 Google LLC
# Licensed under the Apache License, Version 2.0

import os
import sqlite3

DEFAULT_DB_PATH = os.path.join(os.path.dirname(__file__), "creatorflow.db")


def init_db(db_path=DEFAULT_DB_PATH):
    """Initializes the SQLite database with tables and seed data."""
    # Ensure the directory exists
    db_dir = os.path.dirname(db_path)
    if db_dir and not os.path.exists(db_dir):
        os.makedirs(db_dir)

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    # Enable foreign keys
    cursor.execute("PRAGMA foreign_keys = ON;")

    # 1. Create Sponsors Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS sponsors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        review_window_days INTEGER NOT NULL,
        script_guidelines TEXT,
        ai_allowed INTEGER NOT NULL DEFAULT 1 -- 1 for True, 0 for False
    );
    """)

    # 2. Create Videos Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS videos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        sponsor_id INTEGER,
        hard_deadline TEXT NOT NULL, -- YYYY-MM-DD
        ai_disclosure_required INTEGER NOT NULL DEFAULT 0, -- 1 for True, 0 for False
        FOREIGN KEY (sponsor_id) REFERENCES sponsors(id) ON DELETE SET NULL
    );
    """)

    # 3. Create Milestones Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS milestones (
        video_id INTEGER NOT NULL,
        phase TEXT NOT NULL,
        target_date TEXT NOT NULL, -- YYYY-MM-DD
        actual_date TEXT, -- YYYY-MM-DD (NULL if incomplete)
        dependency_offset INTEGER NOT NULL DEFAULT 0, -- Days offset from previous phase
        PRIMARY KEY (video_id, phase),
        FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE
    );
    """)

    # 4. Create AI_Assets Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS ai_assets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        video_id INTEGER NOT NULL,
        type TEXT NOT NULL, -- Audio, Video, Image, etc.
        model_used TEXT NOT NULL, -- Suno, Midjourney, ElevenLabs, etc.
        c2pa_hash TEXT, -- Cryptographic hash or NULL
        description TEXT,
        FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE
    );
    """)

    # Clear old seed data if it exists (for fresh iteration during tests)
    cursor.execute("DELETE FROM ai_assets;")
    cursor.execute("DELETE FROM milestones;")
    cursor.execute("DELETE FROM videos;")
    cursor.execute("DELETE FROM sponsors;")

    # ===============================================================
    # SEED DATA
    # ===============================================================

    # 1. Insert Sponsors
    # TechBrand allows AI and requires 3 days review window.
    # SafeBank bans AI and requires 5 days review window.
    cursor.execute("""
    INSERT INTO sponsors (id, name, review_window_days, script_guidelines, ai_allowed)
    VALUES
        (1, 'TechBrand', 3, 'Incorporate the logo transition in the first 60 seconds.', 1),
        (2, 'SafeBank', 5, 'Include the standard interest rate disclosure statement at the end.', 0);
    """)

    # 2. Insert Videos
    cursor.execute("""
    INSERT INTO videos (id, title, status, sponsor_id, hard_deadline, ai_disclosure_required)
    VALUES
        (1, '10 Editing Tips', 'Editing', 1, '2026-07-31', 0),
        (2, 'AI News Weekly', 'Rough Cut', 2, '2026-07-30', 0),
        (3, 'The Future of VFX', 'Editing', NULL, '2026-07-22', 0),
        (4, 'Building a Tech Setup', 'Scripting', 1, '2026-08-05', 0),
        (5, 'Camera Gear Review', 'Scripting', NULL, '2026-07-28', 0),
        (6, 'Unboxing New Gadgets', 'Filming', 1, '2026-08-01', 0),
        (7, 'Travel Vlog: Tokyo', 'Scripting', NULL, '2026-08-10', 0);
    """)

    # 3. Insert Milestones (Scripting -> Filming -> Editing/Rough Cut -> Review -> Thumbnail -> QC -> Publish)

    # Video 1: "10 Editing Tips" (TechBrand, hard deadline 2026-07-31)
    # Target Publish: 2026-07-27 (Healthy)
    cursor.execute("""
    INSERT INTO milestones (video_id, phase, target_date, actual_date, dependency_offset)
    VALUES
        (1, 'Scripting', '2026-07-10', '2026-07-10', 0),
        (1, 'Filming', '2026-07-13', NULL, 3),
        (1, 'Editing', '2026-07-17', NULL, 4),
        (1, 'Sponsor Review', '2026-07-21', NULL, 4),
        (1, 'Thumbnail', '2026-07-24', NULL, 3),
        (1, 'Publish', '2026-07-27', NULL, 3);
    """)

    # Video 2: "AI News Weekly" (SafeBank, hard deadline 2026-07-30)
    # Target Publish: 2026-07-29. Sponsor Review on 2026-07-22 (more than 5 days review window. On track).
    cursor.execute("""
    INSERT INTO milestones (video_id, phase, target_date, actual_date, dependency_offset)
    VALUES
        (2, 'Scripting', '2026-07-10', '2026-07-10', 0),
        (2, 'Filming', '2026-07-13', NULL, 3),
        (2, 'Rough Cut', '2026-07-16', NULL, 3),
        (2, 'Sponsor Review', '2026-07-22', NULL, 6),
        (2, 'Thumbnail', '2026-07-24', NULL, 2),
        (2, 'Publish', '2026-07-29', NULL, 5);
    """)

    # Video 3: "The Future of VFX" (No Sponsor, hard deadline 2026-07-22)
    # Target Publish: 2026-07-22 (Tight timeline)
    cursor.execute("""
    INSERT INTO milestones (video_id, phase, target_date, actual_date, dependency_offset)
    VALUES
        (3, 'Scripting', '2026-07-10', '2026-07-10', 0),
        (3, 'Filming', '2026-07-13', '2026-07-13', 3),
        (3, 'Editing', '2026-07-16', NULL, 3),
        (3, 'Thumbnail', '2026-07-18', NULL, 2),
        (3, 'Final QC', '2026-07-20', NULL, 2),
        (3, 'Publish', '2026-07-22', NULL, 2);
    """)

    # Video 4: "Building a Tech Setup" (TechBrand, hard deadline 2026-08-05)
    # Target Publish: 2026-07-30 (Healthy)
    cursor.execute("""
    INSERT INTO milestones (video_id, phase, target_date, actual_date, dependency_offset)
    VALUES
        (4, 'Scripting', '2026-07-10', NULL, 0),
        (4, 'Filming', '2026-07-14', NULL, 4),
        (4, 'Editing', '2026-07-20', NULL, 6),
        (4, 'Sponsor Review', '2026-07-24', NULL, 4),
        (4, 'Thumbnail', '2026-07-27', NULL, 3),
        (4, 'Publish', '2026-07-30', NULL, 3);
    """)

    # Video 5: "Camera Gear Review" (No Sponsor, hard deadline 2026-07-28)
    # Target Publish: 2026-07-28 (Healthy)
    cursor.execute("""
    INSERT INTO milestones (video_id, phase, target_date, actual_date, dependency_offset)
    VALUES
        (5, 'Scripting', '2026-07-11', NULL, 0),
        (5, 'Filming', '2026-07-14', NULL, 3),
        (5, 'Editing', '2026-07-18', NULL, 4),
        (5, 'Thumbnail', '2026-07-21', NULL, 3),
        (5, 'Final QC', '2026-07-24', NULL, 3),
        (5, 'Publish', '2026-07-28', NULL, 4);
    """)

    # Video 6: "Unboxing New Gadgets" (TechBrand, hard deadline 2026-08-01)
    # Target Publish: 2026-07-30 (Healthy)
    cursor.execute("""
    INSERT INTO milestones (video_id, phase, target_date, actual_date, dependency_offset)
    VALUES
        (6, 'Scripting', '2026-07-12', '2026-07-12', 0),
        (6, 'Filming', '2026-07-15', NULL, 3),
        (6, 'Editing', '2026-07-20', NULL, 5),
        (6, 'Sponsor Review', '2026-07-24', NULL, 4),
        (6, 'Thumbnail', '2026-07-27', NULL, 3),
        (6, 'Publish', '2026-07-30', NULL, 3);
    """)

    # Video 7: "Travel Vlog: Tokyo" (No Sponsor, hard deadline 2026-08-10)
    # Target Publish: 2026-08-04 (Healthy)
    cursor.execute("""
    INSERT INTO milestones (video_id, phase, target_date, actual_date, dependency_offset)
    VALUES
        (7, 'Scripting', '2026-07-15', NULL, 0),
        (7, 'Filming', '2026-07-18', NULL, 3),
        (7, 'Editing', '2026-07-23', NULL, 5),
        (7, 'Thumbnail', '2026-07-27', NULL, 4),
        (7, 'Final QC', '2026-07-31', NULL, 4),
        (7, 'Publish', '2026-08-04', NULL, 4);
    """)

    # 4. Insert AI Assets
    # Video 2: ElevenLabs Voiceover on SafeBank (banned). Has hash.
    # Video 3: Sora video insert, missing C2PA hash.
    # Video 4: Midjourney thumbnail (allowed, has hash), Suno backing track (allowed).
    # Video 7: ElevenLabs Voiceover (allowed, but missing C2PA hash).
    cursor.execute("""
    INSERT INTO ai_assets (video_id, type, model_used, c2pa_hash, description)
    VALUES
        (2, 'Voiceover', 'ElevenLabs', 'c2pa_elevenlabs_voice_4892c81a', 'AI Voice cloned narration for the sponsor segment'),
        (3, 'Video', 'Sora', NULL, 'Hyper-realistic video insert of a futuristic cityscape'),
        (4, 'Image', 'Midjourney', 'c2pa_midjourney_img_9281bc', 'Cyberpunk tech workspace thumbnail'),
        (4, 'Audio', 'Suno', 'c2pa_suno_track_11a8c3d', 'Lo-fi background beats'),
        (7, 'Voiceover', 'ElevenLabs', NULL, 'Travel vlog voiceover recap');
    """)

    conn.commit()
    conn.close()
    print("Database initialized successfully with seed data.")


if __name__ == "__main__":
    init_db()
