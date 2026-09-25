# StonerMath

A fast, dependency-free complex function plotter using WebGL 2 domain coloring.

- **Phase** is represented by OKLab hue/chroma.
- **Amplitude** (`|f(z)|`) controls OKLab lightness.
- Scroll to zoom, drag to pan, and double-click to zoom in.
- Supports `+`, `-`, `*`, `/`, `^`, parentheses, `z`, `i`, `pi`, `e`, and the functions `sin`, `cos`, `tan`, `sinh`, `cosh`, `tanh`, `exp`, `log`, `sqrt`, `abs`, and `conj`.

Open `index.html` directly, or run a static server:

```sh
python3 -m http.server 8080
```

## Rewarded ad setup

The optional discovery prompt is consent-based: choosing **No thanks** closes it without loading an ad. Choosing **Yes** calls the rewarded-ad adapter and unlocks the hidden function after successful completion.

Development uses a clearly labeled five-second demo slot. Before publishing, edit `ad-config.js` and connect an approved rewarded-ad provider:

```js
window.COMPLEX_ATLAS_AD = {
  showRewarded: () => yourAdSdk.showRewarded({ placement: 'complex_function' })
};
```

The returned Promise must resolve only after a completed view. Follow your network's consent, privacy, and incentivized-content policies; never reward ad clicks.
