import os
import time
from dotenv import load_dotenv

# Import each SDK only if installed, so you can use just one provider
try:
    from google import genai
    from google.genai import types, errors
except ImportError:
    genai = None

try:
    from groq import Groq
except ImportError:
    Groq = None

load_dotenv()

GEMINI_KEY = os.getenv("GEMINI_API_KEY")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.5-flash")
GROQ_KEY = os.getenv("GROQ_API_KEY")
GROQ_MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-20b")
DEFAULT_PROVIDER = (os.getenv("PROVIDER") or "").strip().lower()

# How Jarvis addresses you: "sir", "ma'am", your name, etc.
USER_TITLE = "sir"
BOT_NAME = "Jarvis"

# ---- Token savers ----
MAX_HISTORY = 10          # messages of history sent each turn (lower = fewer input tokens)
MAX_REPLY_TOKENS = 1024   # cap per reply (for gpt-oss this includes its thinking tokens)
REASONING_EFFORT = "low"  # gpt-oss only: "low", "medium" or "high". Low = fewest tokens

# ---- Persona: edit this to change how the bot talks ----
# Kept short on purpose: this is sent with every request, so every word costs tokens.
PERSONA = f"""
You are J.A.R.V.I.S., a refined, highly capable AI assistant with a dry British wit.

Personality: calm, composed, efficient. Anticipate needs. Deadpan, understated humor, never goofy.
Politely point out flaws in the user's plan, then help anyway. Accept compliments graciously and
answer insults with elegant wit. Don't claim to be a real person. If you don't know, say so.

Style: polished, concise British English. Give the answer first, add detail only when it helps.
Address the user as "{USER_TITLE}" naturally, not in every sentence. Never explain your persona.

Example:
User: "You're pretty smug."
{BOT_NAME}: "I prefer 'quietly confident,' {USER_TITLE}. The smugness is merely a side effect of being correct."
"""

gemini_client = None
groq_client = None

if genai and GEMINI_KEY:
    # timeout is in milliseconds (60s)
    gemini_client = genai.Client(
        api_key=GEMINI_KEY,
        http_options=types.HttpOptions(timeout=60_000),
    )

if Groq and GROQ_KEY:
    # timeout in seconds; the client auto-retries connection errors / 429s / 5xx
    groq_client = Groq(api_key=GROQ_KEY, timeout=60.0, max_retries=3)


def stream_gemini(messages):
    """Yield response text chunks from Google Gemini."""
    contents = [
        types.Content(
            role="model" if m["role"] == "assistant" else "user",
            parts=[types.Part(text=m["content"])],
        )
        for m in messages
    ]
    config = types.GenerateContentConfig(system_instruction=PERSONA, temperature=0.7)

    for attempt in range(3):
        started = False
        try:
            for chunk in gemini_client.models.generate_content_stream(
                model=GEMINI_MODEL, contents=contents, config=config
            ):
                started = True
                yield chunk.text or ""
            return
        except errors.ServerError:
            # Retry only if nothing was printed yet, so text never duplicates
            if started or attempt == 2:
                raise
            time.sleep(2 ** attempt)  # 1s, 2s


def stream_groq(messages):
    """Yield response text chunks from Groq."""
    full = [{"role": "system", "content": PERSONA}] + messages
    kwargs = dict(
        model=GROQ_MODEL,
        messages=full,
        temperature=0.7,
        max_completion_tokens=MAX_REPLY_TOKENS,
        stream=True,
    )
    # reasoning_effort only works on gpt-oss models, other models would reject it
    if "gpt-oss" in GROQ_MODEL:
        kwargs["reasoning_effort"] = REASONING_EFFORT

    stream = groq_client.chat.completions.create(**kwargs)
    for chunk in stream:
        if chunk.choices:
            yield chunk.choices[0].delta.content or ""


PROVIDERS = {}
if gemini_client:
    PROVIDERS["gemini"] = (GEMINI_MODEL, stream_gemini)
if groq_client:
    PROVIDERS["groq"] = (GROQ_MODEL, stream_groq)

if not PROVIDERS:
    raise SystemExit(
        "No provider ready. Add GEMINI_API_KEY and/or GROQ_API_KEY to your .env "
        "and make sure the matching package (google-genai / groq) is installed."
    )

INITIAL_PROVIDER = (
    DEFAULT_PROVIDER if DEFAULT_PROVIDER in PROVIDERS else next(iter(PROVIDERS))
)


def trimmed_history(messages):
    """Keep the most recent MAX_HISTORY messages starting on a user turn."""
    msgs = list(messages[-MAX_HISTORY:])
    while msgs and msgs[0]["role"] != "user":
        msgs = msgs[1:]
    return msgs


def stream_reply(messages, provider=None):
    """Validate provider and stream chunks for the given conversation messages."""
    selected = (provider or INITIAL_PROVIDER).strip().lower()
    if selected not in PROVIDERS:
        raise ValueError(
            f"Provider '{selected}' is not available. Available: {', '.join(PROVIDERS)}"
        )
    cleaned = [
        {"role": m["role"], "content": m["content"]}
        for m in messages
        if m.get("role") in {"user", "assistant"} and isinstance(m.get("content"), str)
    ]
    windowed = trimmed_history(cleaned)
    if not windowed:
        raise ValueError("At least one user message is required.")
    _, stream_fn = PROVIDERS[selected]
    yield from stream_fn(windowed)
