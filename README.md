# Valet

A lightweight dual-provider (Google Gemini & Groq) assistant with both a terminal interface and an editorial React web UI served via FastAPI.

## Features

- **Dual LLM providers**: Switch seamlessly between Google Gemini (`google-genai`) and Groq (`groq`) mid-conversation.
- **Streaming responses**: Real-time token streaming over Server-Sent Events (`/api/chat`) in the web UI and direct stdout streaming in the CLI.
- **Editorial React desk UI**: Distraction-free correspondence layout with local thread history, Markdown & code-block rendering, `.md` transcript export, and `Paper` / `Ink` themes.
- **Slash commands**: `/gemini`, `/groq`, `/provider`, and `/clear` (in the web UI) or `exit` (in the CLI).

## Project Structure

```text
.
├── chatbot_core.py   # Shared persona, history windowing, and Gemini/Groq streaming
├── server.py         # FastAPI API + static serving for the built React app
├── app.py            # Terminal CLI entrypoint
├── requirements.txt  # Python dependencies
├── .env.example      # Environment variable template
└── frontend/         # React + Vite frontend
```

## Setup

### 1. Environment Variables

Copy `.env.example` to `.env` and add at least one API key:

```bash
cp .env.example .env
```

### 2. Python Dependencies

```bash
python -m venv venv
# Windows PowerShell:
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

### 3. Build the React UI

```bash
cd frontend
npm install
npm run build
cd ..
```

## Running

### Web UI (Single Server)

```bash
python server.py
```

Open `http://127.0.0.1:8000` in your browser.

For frontend development with hot reload, run `python server.py` in one terminal and in another:

```bash
cd frontend
npm run dev
```

Then open `http://localhost:5173`.

### Terminal CLI

```bash
python app.py
```
