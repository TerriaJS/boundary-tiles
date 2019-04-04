## Boundary-Tiles

These scripts convert source geospatial files into boundary vector tiles, and upload them to AWS S3.

It works on Node 8.2.1, and fails on many other versions, due to missing binaries used by Sqlite3.


```
yarn install
```

### Usage

Each boundary type has a specific identifier (eg, ELB_2019).

1. Add configuration options for the boundary type at the top of the gulpfile.
2. Place source files in `srcdata/ELB_2019`
3. Run `gulp <task>`:

* `toGeojson`: unzips source files and converts to newline-delimited GeoJSON
* `addFeatureIds`: adds a FID field to each GeoJSON feature, writes to a new file.
* `makeRegionIds`: generates a regionids file for each region prop.
* `makeVectorTiles`: generates `mbtiles/ELB_2019.mbtiles` from the FID-enriched GeoJSON file.
* `updateRegionMapping`: adds or updates an entry in `regionMapping/regionMapping.json`.
* `deploy`: uploads the invidiual tiles from the `mbtiles` file to S3.

### Deployment

To use the `gulp deploy` script, first create a `userconfig.json` file in this directory, as follows:

```
{
    "role_arn": "arn:aws:iam::123457890:role/owner",
    "profile": "terria"
}
```

You can find the correct values in your ~/.aws/config file.