from chatbot_core import (
    BOT_NAME,
    INITIAL_PROVIDER,
    PROVIDERS,
    trimmed_history,
)

# ---- Startup banner: edit the text/art here ----
BANNER = r"""
==================================================
     _     _     ____  __     __ ___  ____  
    | |   / \   |  _ \ \ \   / /|_ _|/ ___| 
 _  | |  / _ \  | |_) | \ \ / /  | | \___ \ 
| |_| | / ___ \ |  _ <   \ V /   | |  ___) |
 \___/ /_/   \_\|_| \_\   \_/   |___||____/ 

  At your service.
  Provider : {provider}
  Model    : {model}
  Commands : /gemini  /groq  /provider  exit
==================================================
"""

current = INITIAL_PROVIDER

# Shared history, so you can switch providers mid-conversation
history = []


def ask(user_input):
    history.append({"role": "user", "content": user_input})
    _, stream_fn = PROVIDERS[current]

    reply = ""
    try:
        for text in stream_fn(trimmed_history(history)):
            reply += text
            print(text, end="", flush=True)
        print("\n")
        history.append({"role": "assistant", "content": reply})
    except Exception as e:
        history.pop()  # don't keep the failed message in history
        print(f"\n[{current} error: {e}]\n")


def switch(name):
    global current
    if name not in PROVIDERS:
        print(f"[{name} isn't available. Check its key in .env and that its package is installed.]\n")
        return
    current = name
    print(f"[Switched to {current} ({PROVIDERS[current][0]})]\n")


if __name__ == "__main__":
    print(BANNER.format(provider=current, model=PROVIDERS[current][0]))
    try:
        while True:
            user_input = input("You: ").strip()
            cmd = user_input.lower()
            if cmd in {"exit", "quit"}:
                break
            if not user_input:
                continue
            if cmd in {"/gemini", "/groq"}:
                switch(cmd[1:])
                continue
            if cmd == "/provider":
                print(f"[Using {current} ({PROVIDERS[current][0]}). Available: {', '.join(PROVIDERS)}]\n")
                continue
            print(f"{BOT_NAME}: ", end="", flush=True)
            ask(user_input)
    except KeyboardInterrupt:
        print("\nBye!")
