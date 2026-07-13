# Contributing to FireSight

FireSight is a static browser app (Leaflet + vanilla JS) with optional Python
helper scripts. There's no build step and no API key.

## Setup

```bash
git clone https://github.com/zelinewang/FireSight.git
cd FireSight
python3 -m http.server 8000
# open http://localhost:8000/src/ and click "Update"
```

## Checks

CI runs exactly two checks — please run them before pushing:

```bash
node --check src/app.js             # browser JS syntax
python3 -m py_compile scripts/*.py  # Python helper syntax
```

The `scripts/` helpers are optional/offline and are not loaded by the web app;
please keep that separation.

## Pull requests

- Branch off `main`; open one focused PR per change.
- Conventional-ish commit subjects (`fix:`, `feat:`, `docs:`…). PRs are
  squash-merged.
- The app must keep working with no build and no key — don't add a required
  bundler or server dependency for a client-side change.

## License

By contributing, you agree that your contributions are licensed under the
project's [MIT License](LICENSE).
