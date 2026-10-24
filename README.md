# @iobroker/youtube-lounge

Control the YouTube app of a TV over the YouTube Lounge API - the way "Link with TV" of the YouTube app on a phone
works: play a video, a playlist or the uploads of a channel, pause, skip, seek, and follow what the TV plays.

It works with every device whose YouTube app offers "Link with TV": smart TVs (Samsung, LG, Sony, Philips, ...),
Android TV / Google TV, Fire TV, game consoles.

**Note:** The Lounge API is not documented by Google; the protocol follows
[pyytlounge](https://github.com/FabioGNR/pyytlounge) and may change. The requests go to Google's servers
(`https://www.youtube.com/api/lounge`), so an internet connection is needed. Only finding the TV and reading its
screen ID (DIAL) stay in the local network.

## Usage

```js
const {
    YouTubeLounge,
    discoverDialDevices,
    getYouTubeScreenId,
    parseYouTubeTarget,
} = require('@iobroker/youtube-lounge');

const lounge = new YouTubeLounge({ name: 'ioBroker' });

// Pair: either with the screen ID the TV reports over DIAL ...
const [tv] = await discoverDialDevices();
const screenId = await getYouTubeScreenId(tv.appUrl); // many TVs report it only while the app runs
await lounge.pairWithScreenId(screenId);
// ... or with the code of the YouTube app on the TV: Settings > Link with TV code
await lounge.pairWithCode('123 456 789 012');

// lounge.screen can be stored and given to lounge.useScreen() later, so no pairing is needed again

await lounge.play(parseYouTubeTarget('https://www.youtube.com/watch?v=jNQXAC9IVRw'));
await lounge.play(parseYouTubeTarget('UCbmF2AHnpQsogOLW-MxBiJg')); // the uploads of a channel
await lounge.play(parseYouTubeTarget('pause'));
await lounge.seekTo(90);

lounge.on('nowPlaying', playing => console.log(playing)); // { videoId, listId, currentTime, duration, state } or null
lounge.on('volume', ({ volume, muted }) => console.log(volume, muted));
lounge.subscribe();
// ...
lounge.close();
```

`parseYouTubeTarget` takes a video ID, a playlist ID (`PL…`), a channel ID (`UC…`), a youtube.com / youtu.be URL, or
`play`, `pause`, `next`, `previous`. Handles (`@name`) cannot be resolved without the YouTube Data API.

An expired lounge token is renewed with the screen ID, an ended session is opened again, both on their own.

Google accepts commands also while the YouTube app of the TV is not open, and they get lost. Right after the TV or
the app was started, wait for it: `await lounge.waitForScreen(30000)` (`true` once the app is there);
`lounge.screenOnline` and the event `screen` tell it later on.

<!--
	Placeholder for the next version (at the beginning of the line):
	### **WORK IN PROGRESS**
-->

## Changelog
### 0.2.0 (2026-10-24)

- (@GermanBluefox) Added `waitForScreen()`, `screenOnline` and the event `screen`: commands sent before the YouTube app joined got lost

### 0.1.0 (2026-10-24)

- (@GermanBluefox) Initial release, taken from the adapter `samsungtv`

## License

MIT License

Copyright (c) 2026 Denis Haev <dogafox@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
