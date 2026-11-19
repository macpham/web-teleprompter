# Web Teleprompter

A voice-following teleprompter PWA. Paste a script, press **Start**, and read aloud. Words light up magenta as they're recognised, finished lines turn gray, and the line you're on stays in the highlighted band in the middle of the screen.

Live: https://macpham.github.io/web-teleprompter/

## Controls

- **Start / Stop**: start or pause listening. Stop keeps your place.
- **Reset**: go back to the first line.
- **A− / A+**: font size (remembered).
- **Mirror** (blue button): flip the prompt screen for a beam-splitter teleprompter, where you read the screen reflected in angled glass. Each tap steps to the next mode: left–right, top–bottom, both, then off. A single mirror needs exactly one flip; which one depends on which way round the device sits under the glass, so try left–right and top–bottom and keep the one that reads correctly. The choice is remembered, and the button is white while a mode is on.
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

When you change app files, bump `APP_VERSION` near the top of `index.html`. It's shown at the bottom of Settings, and changing it is what delivers the update.

Refreshing the page while online always loads the current release, as one matching set of files:

- The version is part of the stylesheet and script URLs (`styles.css?v=N`, `app.js?v=N`), so a new release has new URLs that no cache can answer with old files. Browsers re-check the page itself on refresh but reuse the files it links to; GitHub Pages lets them do that for 10 minutes.
- The service worker (`sw.js`) re-checks every file with the server instead of trusting the browser's cache, so opening the app also gets the current release.
