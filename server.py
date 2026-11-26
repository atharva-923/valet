import json
from pathlib import Path
from typing import Literal, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from chatbot_core import (
    BOT_NAME,
    INITIAL_PROVIDER,
    MAX_HISTORY,
    PROVIDERS,
    USER_TITLE,
    stream_reply,
)

BASE_DIR = Path(__file__).resolve().parent
FRONTEND_DIST = BASE_DIR / "frontend" / "dist"

app = FastAPI(title="Valet API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1)


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1)
    provider: Optional[str] = None


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/config")
def get_config():
    return {
        "botName": BOT_NAME,
        "userTitle": USER_TITLE,
        "maxHistory": MAX_HISTORY,
        "defaultProvider": INITIAL_PROVIDER,
        "providers": [
            {
                "id": key,
                "label": key.capitalize(),
                "model": model,
            }
            for key, (model, _) in PROVIDERS.items()
        ],
    }


@app.post("/api/chat")
def chat(request: ChatRequest):
    selected = (request.provider or INITIAL_PROVIDER).strip().lower()
    if selected not in PROVIDERS:
        raise HTTPException(
            status_code=400,
            detail=f"Provider '{selected}' is not available.",
        )

    payload_messages = [m.model_dump() for m in request.messages]

    def event_stream():
        try:
            for chunk in stream_reply(payload_messages, provider=selected):
                if chunk:
                    yield f"data: {json.dumps({'type': 'delta', 'text': chunk})}\n\n"
            yield f"data: {json.dumps({'type': 'done'})}\n\n"
        except Exception as exc:
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


if FRONTEND_DIST.exists():
    assets_dir = FRONTEND_DIST / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/{full_path:path}")
    def serve_spa(full_path: str):
        candidate = (FRONTEND_DIST / full_path).resolve()
        if (
            full_path
            and candidate.is_file()
            and candidate.is_relative_to(FRONTEND_DIST.resolve())
        ):
            return FileResponse(candidate)
        return FileResponse(FRONTEND_DIST / "index.html")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("server:app", host="127.0.0.1", port=8000, reload=True)
