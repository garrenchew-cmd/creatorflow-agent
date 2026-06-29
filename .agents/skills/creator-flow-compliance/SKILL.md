---
name: creator-flow-compliance
description: Manages and validates CreatorFlow video pipeline timelines, milestones, sponsor contract rules, and platform disclosures.
---

# CreatorFlow Compliance & Timeline Skill

This skill provides guidelines for managing the CreatorFlow SQLite production database and checking compliance for active video projects.

## Project Structure & Data Schema
The local database is stored at `creatorflow.db`. It contains four main tables:
1. `videos`: Primary video table.
2. `milestones`: Chronological phases (Scripting, Filming, Rough Cut, Sponsor Review, Thumbnail, Final QC, Upload).
3. `sponsors`: Sponsor contract details, review window days, and AI policies.
4. `ai_assets`: Generative AI assets logged for a video.

## Compliance Auditing Rules
- **Sponsor AI Usage Policy**: If a sponsor has `ai_allowed = 0`, but there are assets logged in `ai_assets` for that video, flag a **CRITICAL COMPLIANCE VIOLATION**.
- **Sponsor Review Window**: The target date of the 'Sponsor Review' milestone must be at least `review_window_days` before the 'Publish' milestone.
- **Platform Disclosures**: Real synthetic media (e.g., voiceovers from ElevenLabs, realistic synthetic video from Sora) requires warning the creator that they must mark the 'Altered or Synthetic Content' label on YouTube/TikTok during upload.

## Date Math Rules
- When shifting dates, weekends and US 2026 Federal Holidays should be skipped depending on the user's/agent's configuration.
