# Web Teleprompter

A voice-following teleprompter PWA. Paste a script, press **Start**, and read aloud. Words light up magenta as they're recognised, finished lines turn gray, and the line you're on stays in the highlighted band in the middle of the screen.

Live: https://macpham.github.io/web-teleprompter/

## Controls

- **Start / Stop**: start or pause listening. Stop keeps your place.
- **Reset**: go back to the first line.
- **A− / A+**: font size (remembered).
- **Mirror** (blue button): flip the prompt screen left-to-right for a beam-splitter teleprompter, where you read the screen reflected in angled glass. It stays on until you turn it off; the button is white while it's on. If the reflection is upside down, turn the device around.
- **Edit**: paste, type or clear the script (saved on the device). The edit screen is never mirrored.
- **Tap any word** to set your place manually.

If speech recognition isn't available (or is blocked), the app switches to timed auto-scroll with Slower/Faster controls.

## Phone and tablet layouts

The app works in portrait and landscape. When it has tablet-sized room (at least 700 × 600 CSS px, e.g. an iPad full screen in either orientation), it switches to a tablet layout: larger default text (56 px instead of 40, adjustable up to 144), wider margins, compact centred buttons and a centred editing column. An iPad showing the app in a narrow Split View column gets the phone layout.

## iPhone and iPad notes

- Uses the browser's Web Speech API (`webkitSpeechRecognition`). Safari supports it; Chrome on iOS may not.
- Speech recognition on iOS requires **Settings › General › Keyboard › Enable Dictation** (and Siri may need to be on).
- To install: Share › **Add to Home Screen**.

## Development

Plain HTML/CSS/JS with no build step. Serve the folder with any static server, e.g. `python3 -m http.server`, and open `http://localhost:8000`. Microphone access requires `localhost` or HTTPS.

When you change app files, bump `APP_VERSION` in `version.js`. It's shown at the bottom of Settings, and changing it makes installed copies update.
