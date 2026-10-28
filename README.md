# Web Teleprompter

A voice-following teleprompter PWA. Paste a script, press **Start**, and read aloud. Words light up magenta as they're recognised, finished lines turn gray, and the line you're on stays in the highlighted band in the middle of the screen.

Live: https://macpham.github.io/web-teleprompter/

## Controls

- **Start / Stop**: start or pause listening. Stop keeps your place.
- **Reset**: go back to the first line.
- **A− / A+**: font size (remembered).
- **Edit**: paste, type or clear the script (saved on the device).
- **Tap any word** to set your place manually.

If speech recognition isn't available (or is blocked), the app switches to timed auto-scroll with Slower/Faster controls.

## iPhone notes

- Uses the browser's Web Speech API (`webkitSpeechRecognition`). Safari supports it; Chrome on iOS may not.
- Speech recognition on iOS requires **Settings › General › Keyboard › Enable Dictation** (and Siri may need to be on).
- To install: Share › **Add to Home Screen**.

## Development

Plain HTML/CSS/JS with no build step. Serve the folder with any static server, e.g. `python3 -m http.server`, and open `http://localhost:8000`. Microphone access requires `localhost` or HTTPS.

When you change app files, bump `VERSION` in `sw.js` so installed copies update.
