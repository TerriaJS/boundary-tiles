# Boundary-Tiles

These scripts convert source geospatial files into boundary vector tiles.

```bash
yarn install
```

## Pre-requisites

- GDAL 2.4.0 or later (GDAL 3 untested, but may work)
  - Optional. Used for converting shapefile to GeoJSON in `toGeoJSON` step
- [Tippecanoe](https://github.com/mapbox/tippecanoe) version 1.32.10 or later
  - Required for creating vector tiles in `makeVectorTiles` step
- NodeJS (v14 working)

## How to add a new boundary type

### Setup config

Each boundary type has a specific identifier (eg, `DEMO_TRIANGLES`).

1. Add configuration options for the boundary type to [`config.json5`](./config.json5)
2. Place source files in [`srcdata`](./srcdata) (matching boundary type name in [`config.json5`](./config.json5))

**Optional ENVs**

- Override the configuration file to be read with environment variable:
  `export BOUNDARYTYPESCONFIG="./config-terria.json5"`
- Limit the boundary type(s) with comma-separated types in environment variable:
  `export BOUNDARYTYPES=DEMO_TRIANGLES`

### Prepare GeoJSON

#### If using `shapeNames`/shapefiles in [`config.json5`](./config.json5)

- `gulp toGeoJSON`: unzips source files and converts to newline-delimited GeoJSON

#### OR If using geoJSON file

Convert GeoJSON to [ndjson](http://ndjson.org/)

- `yarn run geojson2ndjson $INPUT_GEOJSON_PATH > ./geojson/$BOUNDARY_TYPE.nd.json`
  - set `$BOUNDARY_TYPE` - for example `DEMO_TRIANGLES``

### Then run

Run `gulp <task>`:

1. `addFeatureIds`: adds a FID field to each GeoJSON feature, writes to a new file.
2. `makeRegionIds`: generates a regionids file for each region prop.
3. `makeVectorTiles`: generates `mbtiles/$BOUNDARY_TYPE/{z}/{x}/{y}.pbf` from the FID-enriched GeoJSON file.
4. `updateRegionMapping`: adds or updates an entry in [`regionMapping/regionMapping.json`](./regionMapping/regionMapping.json).
5. `all`: does all of the above (including `toGeoJSON`)

### Preview tiles

**WARNING** this will serve the entire `boundary-tiles` directory on port 3000.

This assumes you have `TerriaMap` running on port 3001

Run `gulp previewInTerria` and click on link in console

### Add to TerriaJS region mapping

1. Splice into `wwwroot/data/regionMapping.json` part of the generated [`regionMapping/regionMapping.json`](./regionMapping/regionMapping.json)
2. Update other entries in `wwwroot/data/regionMapping.json` if the default year for a region type has now changed.
3. Copy into `wwwroot/data/regionids/` the generated files in [`regionMapping/regionids/`](./regionMapping/regionids/)

### Adding a new boundary type to be uploaded to tiles.terria.io

Configuration should be added to [`config-terria.json5`](./config-terria.json5) and committed to the repo to preseve the options used.

### Upload vector tiles to AWS S3

```bash
aws --profile terria s3 cp ./mbtiles/$BOUNDARY_TYPE s3://tiles.terria.io/$BOUNDARY_TYPE --recursive
```

- You can run the above command with `--dryrun` flag to see uploaded paths

You may want to increase number of concurrent requests

```bash
aws configure set s3.max_concurrent_requests 50 --profile terria
```
