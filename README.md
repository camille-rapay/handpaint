# HandPaint (web)

A browser version of HandPaint: the same two paint layers (Feathered and Dithered), Rainbow / Multicolor / Solid / Eraser,
left-hand smudge, undo, aspect ratios, PNG export and video recording, all drawn with WebGL 2.

## Run it

```bash
cd web
python3 serve.py
```

(`serve.py` is a small server that tells the browser not to cache, so a normal reload always shows the latest files.)

Open <http://localhost:8000> in Chrome (a camera only works on `localhost` or an `https://` address).
Click **Turn on camera** (right hand paints, left hand smudges), **Try demo hands**, or just use the mouse
(drag paints, Shift + drag smudges, keys 1-5 pick the brush size).

Hand tracking loads MediaPipe from jsdelivr.net and Google's model host the first time, so it needs internet.

## Sharing it

It is a static folder (`index.html`, `css/`, `js/`): drop it on any static host (Netlify Drop, GitHub Pages, Vercel...)
and send the link. `?debug` adds a few developer helpers.

## Transparent video

Set the Background's alpha to 0 (or lower), then record. Every frame is rendered with its alpha channel, recorded by the browser
as WebM (VP9 with alpha), and then converted to **QuickTime Animation (RGBA) `.mov`** by ffmpeg running inside the page (it is fetched once from
jsdelivr.net, about 32 MB, so this needs internet the first time). Press **Export MOV** to save it to your Downloads folder; After Effects
and Premiere open it with the transparency intact.

- Needs Chrome or Edge (Safari and Firefox cannot record WebM with alpha).
- Takes stop at 30 seconds. Conversion takes roughly 5 times the length of the take, and the file can be around 30 MB per second
  when the canvas is full of paint (far less when it is mostly empty).
- If the conversion fails (for example no internet), the take is kept as a WebM with alpha, which Chrome and Firefox play and ffmpeg can convert.
- An opaque background records an ordinary video (`.mp4` or `.webm`).
