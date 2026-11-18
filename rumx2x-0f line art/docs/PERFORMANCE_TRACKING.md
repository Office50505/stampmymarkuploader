# Line art uploader performance tracking

The uploader emits privacy-safe structured metrics to the Railway application
logs. Filter Railway logs for:

```text
stamp_upload_performance
```

Each JSON entry contains:

- `source`: `client` for customer-perceived time or `server` for backend work.
- `phase`: `upload`, `line_art`, `mockups`, `ink_switch`, `instant_preview`, or
  `mockup_kind`.
- `outcome`: `success`, `failure`, `queued`, or `cancelled`.
- `durationMs`: elapsed time in milliseconds, capped at ten minutes.
- `mode`: the path taken, such as `fast_path`, `ai`, `cache`, `render`, or `store`.
- `kind`: present for individual `bag`, `cup`, or `box` mockup timings.
- `inkColor`, `previewCount`, and a safe `errorCode` when relevant.
- `uploadRef`: a short one-way hash used to correlate phases without logging the upload ID.

Artwork, filenames, design notes, customer details, session IDs, and raw errors
are never written to these metrics. Client reporting is fire-and-forget, so a
metrics failure cannot delay or break the upload flow.
