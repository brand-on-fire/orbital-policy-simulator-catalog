# orbital-policy-simulator-catalog

The companion catalog feed for the [Orbital Policy Simulator](https://projects.brandonernst.com/orbital-policy-simulator).
It publishes the full active-payload catalog (CelesTrak `GROUP=active` GP elements joined to SATCAT) as a single
`catalog:active` columnar file plus a tiny manifest on the **`catalog-data`** branch.

## Why a separate repo

The simulator's main data feed (`orbital-policy-simulator-data`, `public-data` branch) is an append-only,
content-addressed, size-guarded feed of small verified datasets, and it is deliberately **not a catalog mirror**.
The full active catalog (~2.5 MB) changes every refresh, so publishing it into that append-only feed would grow it
~2 MB/day and eventually trip its 200 MiB publish guard, halting the whole feed.

This repo keeps that churn out of the guarded feed. The `catalog-data` branch is **force-reset** to one rootless
commit on every run, so its reachable content is always exactly one manifest + one catalog file (~2.5 MB) no matter
how many times it has published. Storage is bounded by construction, independent of GitHub gc timing, and this repo
has no size guard to trip.

## How it works

`.github/workflows/collect.yml` runs `scripts/build-and-publish.mjs` once a day (and on demand):

1. one `GROUP=active` GP request + the bulk SATCAT CSV from CelesTrak (identified User-Agent, 30 s timeout, stop on
   any non-200, no retries);
2. build `catalog:active` (dedupe newest-epoch, drop the NEA denylist, join SATCAT, guard count and the 6 MiB cap);
3. force-reset `catalog-data` to a single commit holding `manifest.json` + `catalog/<sha256>.json`.

The app reads `https://raw.githubusercontent.com/brand-on-fire/orbital-policy-simulator-catalog/catalog-data/`,
SHA-256-verifies the file against the manifest, and renders it; if this feed is ever missing or fails verification
the app falls back to its roster and sampled layers.

Build logic (`scripts/lib/build.mjs`) is pure and covered by offline tests (`npm test`). Snapshot only, for
visualization: **not an archive and not for conjunction assessment.**
