# ADR-0003: Cache identity is a tuple, and the budget is in bytes

Status: accepted
Date: 2026-09-16

## Context

The renderer at the starting commit cached decoded pages in a
`Map<number, SkImage>` keyed by page index alone, evicted by keeping a set of
six indices, and disposed images from the loader effect.

Every part of that is wrong once documents can reflow:

- **Index alone is not identity.** After a relayout, page 7 is different
  content. After a viewport change, page 7 needs a different raster size. After
  a document swap, page 7 is a different book entirely. All three collide on the
  same key.
- **The viewport was not even a dependency.** `texW`/`texH` derive from the
  measured size, but the loader effect's dependency array was
  `[source, pageIndex, leafIndex, spread, step]`. Rotating the device produced
  correctly laid out pages at the old raster size.
- **A count of six images is not a memory bound.** Six spread pages on a tablet
  at 3x are not the same number of bytes as six phone pages at 2x.
- **`dispose()` from the loader is a use-after-free hazard.** The shader may
  still be sampling that texture in the frame currently animating.

## Decision

Cache key is the tuple:

    (documentId, documentGeneration, layoutGeneration, location, renderWidth, renderHeight, rotation, appearanceHash)

`documentGeneration` and `layoutGeneration` come from the engine and are stamped
onto every render result (`EncodedPage::generations`, `RawPage::generations`), so
a late result can be compared against the current pair and dropped rather than
painted.

Eviction is byte-budgeted, not count-budgeted. Three budgets are tracked
separately because they are three different allocators:

| Budget | Owner | Default |
| --- | --- | --- |
| fitz store | `fz_new_context(..., max_store)` | 48 MB |
| decoded images / GPU textures | renderer cache | measured per device |
| in-flight render buffers | bounded by the executor's single worker | one page |

A texture referenced by the currently displayed or animating frame is retained
until the renderer releases it. Eviction from the map marks an image for
release; the actual `dispose()` happens once no frame references it.

## Status of implementation

The engine half is done and tested: generations are stamped, the fitz store
budget is a constructor parameter, and a stale result is detectable.

The renderer half — the tuple key, the byte budget, the retain-until-released
handoff — is **not yet implemented**. `src/renderer/PageCurlView.tsx` still
carries the index-keyed map described above. See the delivery report for status.
