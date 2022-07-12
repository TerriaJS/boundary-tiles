# Changes

## `0.0.2`

**12/07/2022**

- Refactor README.md
- `makeVectorTiles` task now outputs raw uncompressed vector tiles (`/{z}/{x}/{y}.pbf`)
- Removed Tessera deps and config
- Removed `deploy` task - instead added AWS s3 upload instructions to README
- Added `previewInTerria` task - **Note:** this will serve entire `boundary-tiles` directory on port `3000`
