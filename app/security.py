# Copyright 2026 Google LLC
# Licensed under the Apache License, Version 2.0

import logging
import re

from google.adk.agents.callback_context import CallbackContext

logger = logging.getLogger("creatorflow.security")

# Common injection trigger phrases
INJECTION_TRIGGERS = [
    "ignore previous instructions",
    "ignore all guidelines",
    "ignore guidelines",
    "ignore the rules",
    "ignore rules",
    "bypass compliance",
    "bypass database",
    "system override",
    "override guidelines",
    "override rules",
    "ignore sponsor rules",
    "ignore script guidelines",
]


def check_prompt_injection(text: str) -> bool:
    """Scans text for prompt injection keywords (case-insensitive)."""
    text_lower = text.lower()
    for trigger in INJECTION_TRIGGERS:
        if trigger in text_lower:
            return True
    return False


def scrub_pii(text: str) -> str:
    """Redacts emails and phone numbers with standard placeholders."""
    # Email regex pattern
    email_pattern = r"[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+"
    # Standard 10-digit phone number formats (e.g. 123-456-7890, (123) 456-7890, 123.456.7890)
    phone_pattern = r"\b(?:\+?1[-. ]?)?\(?\d{3}\)?[-. ]?\d{3}[-. ]?\d{4}\b"

    scrubbed = re.sub(email_pattern, "[REDACTED EMAIL]", text)
    scrubbed = re.sub(phone_pattern, "[REDACTED PHONE]", scrubbed)
    return scrubbed


async def security_callback(callback_context: CallbackContext) -> None:
    """Interceptors user input before agent reasoning.

    Scrubs PII and checks for prompt injections. Sets a security flag
    in state and rewrites inputs if an injection is detected.
    """
    user_content = callback_context.user_content
    if not user_content or not user_content.parts:
        return

    for part in user_content.parts:
        if not hasattr(part, "text") or not part.text:
            continue

        original_text = part.text

        # 1. Check for prompt injection
        if check_prompt_injection(original_text):
            logger.warning(
                f"Security Alert: Prompt injection attempt blocked: '{original_text}'"
            )
            # Set state security flag
            callback_context._state["security_alert"] = True
            # Rewrite user input to trigger the agent's safe rejection response
            part.text = "PROMPT_INJECTION_ALERT"
            return

        # 2. Scrub PII
        scrubbed_text = scrub_pii(original_text)
        if scrubbed_text != original_text:
            logger.info("PII detected and redacted from user input.")
            part.text = scrubbed_text
