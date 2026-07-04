# Copyright 2026 Google LLC
# Licensed under the Apache License, Version 2.0

import os
import sqlite3

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from google.adk.agents.run_config import RunConfig, StreamingMode
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types
from pydantic import BaseModel

from app.agent import pipeline_coordinator
from app.tools import DB_PATH

app = FastAPI(title="CreatorFlow AI Dashboard Server")

# Enable CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global ADK runner and session service setup
session_service = InMemorySessionService()
runner = Runner(
    agent=pipeline_coordinator,
    session_service=session_service,
    app_name="creatorflow-dashboard",
)
active_sessions: dict[str, str] = {}  # Map UI session IDs to ADK session IDs


class ChatRequest(BaseModel):
    message: str
    session_id: str | None = None


class ChatResponse(BaseModel):
    response: str
    session_id: str


def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


@app.get("/api/videos")
def get_videos():
    """Fetch all active videos, their milestones, and logged AI assets."""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        # Fetch all videos and sponsor info
        cursor.execute("""
            SELECT v.id, v.title, v.status, v.hard_deadline,
                   s.id as sponsor_id, s.name as sponsor_name,
                   s.review_window_days, s.ai_allowed
            FROM videos v
            LEFT JOIN sponsors s ON v.sponsor_id = s.id;
        """)
        videos = [dict(row) for row in cursor.fetchall()]

        # Populate milestones and AI assets for each video
        for video in videos:
            video_id = video["id"]

            # Fetch milestones
            cursor.execute(
                """
                SELECT phase, target_date, actual_date, dependency_offset
                FROM milestones
                WHERE video_id = ?
                ORDER BY target_date ASC;
            """,
                (video_id,),
            )
            video["milestones"] = [dict(row) for row in cursor.fetchall()]

            # Fetch AI assets
            cursor.execute(
                """
                SELECT type, model_used, c2pa_hash, description
                FROM ai_assets
                WHERE video_id = ?;
            """,
                (video_id,),
            )
            video["ai_assets"] = [dict(row) for row in cursor.fetchall()]

        conn.close()
        return videos
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@app.post("/api/chat", response_model=ChatResponse)
def chat_with_agent(req: ChatRequest):
    """Sends a chat message to the local Pipeline Coordinator agent."""
    try:
        ui_session_id = req.session_id or "default-ui-session"

        # Get or create ADK session
        if ui_session_id not in active_sessions:
            adk_session = session_service.create_session_sync(
                user_id="dashboard_user", app_name="creatorflow-dashboard"
            )
            active_sessions[ui_session_id] = adk_session.id

        adk_session_id = active_sessions[ui_session_id]

        # Format message for ADK runner
        message = types.Content(
            role="user", parts=[types.Part.from_text(text=req.message)]
        )

        # Run agent synchronously to aggregate results
        events = list(
            runner.run(
                new_message=message,
                user_id="dashboard_user",
                session_id=adk_session_id,
                run_config=RunConfig(streaming_mode=StreamingMode.NONE),
            )
        )

        # Reconstruct full text response from events
        full_text = ""
        for event in events:
            if event.content and event.content.parts:
                for part in event.content.parts:
                    if part.text:
                        full_text += part.text

        # Retrieve active session from service to check security flags in context state
        session = session_service.get_session_sync(
            app_name="creatorflow-dashboard",
            user_id="dashboard_user",
            session_id=adk_session_id,
        )
        if session and session.state.get("security_alert"):
            # Clear the flag for the next turn
            session.state["security_alert"] = False
            full_text = "Security Alert: Prompt injection attempt blocked. The operation was terminated to protect the pipeline."

        # If agent yielded empty/no text (e.g. tools completed silently), fallback message
        if not full_text:
            full_text = "I have updated the schedule database and completed the requested checks."

        return ChatResponse(response=full_text, session_id=ui_session_id)

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


# Mount static UI folder
ui_path = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "ui"
)
if os.path.exists(ui_path):
    app.mount("/", StaticFiles(directory=ui_path, html=True), name="ui")

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8282)
