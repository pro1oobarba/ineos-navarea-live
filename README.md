# INEOS NAVAREA — Live ECDIS Files

Auto-published NAVAREA warning files, converted to JRC ECDIS user-map CSV. This repo is public
on purpose — NAVAREA warnings are public maritime safety information, not sensitive data — so the
files are downloadable from any computer without logging in.

Generated automatically by [ineos-nav-toolkit](https://github.com/pro1oobarba/ineos-nav-toolkit)
(the private toolkit repo, kept separate to avoid publishing vessel/crew-specific files here).

## Stable download links (always the latest file, no login)

```
https://raw.githubusercontent.com/pro1oobarba/ineos-navarea-live/main/output/NAVAREA_IV_latest.csv
https://raw.githubusercontent.com/pro1oobarba/ineos-navarea-live/main/output/NAVAREA_I_latest.csv
```

Paste either link straight into a browser on any computer (work PC included) — it downloads/opens
the file directly, no GitHub account needed.

## Dated history

Every run also keeps a dated copy in `output/` (e.g. `NAVAREA_IV_usermap_20260813_0600.csv`) so
you can see what changed day to day. **Files older than 30 days are deleted automatically** by
`.github/workflows/cleanup.yml` — this repo is meant to stay small, not be a permanent archive.
The permanent history (if you ever need it) lives in the private toolkit repo's `navarea-agent/output/`.

## Not for redistribution as a paid service

This repo republishes data sourced from [SeaLagom](https://www.sealagom.com)'s free public pages.
See the toolkit repo's notes on SeaLagom's terms before building anything commercial on top of this.
