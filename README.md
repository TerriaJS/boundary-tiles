## Boundary-Tiles

These scripts convert source geospatial files into boundary vector tiles, and upload them to AWS S3.

It works on Node 8 (tested on v8.15.1), and fails on many other versions, due to missing binaries used by Sqlite3.

```
npm install
```

### Pre-requisites

- GDAL 2.4.0 or later (GDAL 3 untested, but may work)
  - Optional. Used for converting shapefile to GeoJSON in `toGeoJSON` step
- [Tippecanoe](https://github.com/mapbox/tippecanoe) version 1.32.10 or later
  - Required for creating vector tiles in `makeVectorTiles` step
- Node 8 (tested on v8.15.1)

### How to add a new boundary type

Each boundary type has a specific identifier (eg, DEMO_TRIANGLES).

1. Add configuration options for the boundary type to `config.json5` (or other configuration file if using `BOUNDARYTYPESCONFIG` environment variable).
2. Place source files in `srcdata/DEMO_TRIANGLES`
3. Run gulp:
   1. Optionally set the configuration file to be read with environment variable:
      `export BOUNDARYTYPESCONFIG="./config-terria.json5"`
   2. Optionally limit the boundary type(s) with comma-separated types in environment variable:
      `export BOUNDARYTYPES=DEMO_TRIANGLES`
   3. Run `gulp <task>`:

- `toGeoJSON`: unzips source files and converts to newline-delimited GeoJSON
- `addFeatureIds`: adds a FID field to each GeoJSON feature, writes to a new file.
- `makeRegionIds`: generates a regionids file for each region prop.
- `makeVectorTiles`: generates `mbtiles/DEMO_TRIANGLES.mbtiles` from the FID-enriched GeoJSON file.
- `updateRegionMapping`: adds or updates an entry in `regionMapping/regionMapping.json`.
- `all`: does all of the above
- `deploy`: uploads the invidiual tiles from the `mbtiles` file to S3. You will need your MFA device.

4. In TerriaJS:
   1. Create a branch.
   2. Splice into wwwroot/data/regionMapping.json part of the generated regionMapping/regionMapping.json
   3. Update other entries in wwwroot/data/regionMapping.json if the default year for a region type has now changed.
   4. Copy into wwwroot/data/regionids/ the generated files in regionMapping/regionids/
   5. Open pull request.

### What if I have GeoJSON instead of zipped shapefiles?

First convert the GeoJSON to [ndjson](http://ndjson.org/):

`npm run geojson2ndjson triangles.geojson > ./geojson/DEMO_TRIANGLES.nd.json`

Then run tasks as above, skipping `toGeoJSON`.

### Adding a new boundary type to be uploaded to tiles.terria.io

Configuration should be added to `config-terria.json5` and committed to the repo to preseve the options used.

### Deploy to AWS 

Use https://github.com/rowanwins/mbtiles-extractor to deploy tiles to an S3 bucket.

### Setting up AWS

Setting up AWS to serve vector tiles directly from S3 requires three main bits:

- an S3 bucket configured as a static website, with CORS enabled
- a Route53 subdomain pointing at it
- a CloudFront distribution pointing to the subdomain, with certificate and CORS settings

#### S3: Create bucket

1. Name it according to the subdomain you will use, eg `tiles.terria.io`
   - Region: Asia Pacific (Sydney)
   - Uncheck all four "Manage public access control lists (ACLs) for this bucket" and "Manage public bucket policies for this bucket" options
2. In the bucket, Permissions > Bucket Policy, paste this (updating the bucket name):

```
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "PublicReadForGetBucketObjects",
            "Effect": "Allow",
            "Principal": "*",
            "Action": "s3:GetObject",
            "Resource": "arn:aws:s3:::tiles.terria.io/*"
        },
        {
            "Sid": "PublicReadForListBucketContents",
            "Effect": "Allow",
            "Principal": "*",
            "Action": "s3:ListBucket",
            "Resource": "arn:aws:s3:::tiles.terria.io"
        }
    ]
}
```

3. On Permissions > CORS Configuration, add this configuration:

```
<?xml version="1.0" encoding="UTF-8"?>
<CORSConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
<CORSRule>
    <AllowedOrigin>*</AllowedOrigin>
    <AllowedMethod>GET</AllowedMethod>
    <MaxAgeSeconds>3000</MaxAgeSeconds>
    <AllowedHeader>Authorization</AllowedHeader>
</CORSRule>
</CORSConfiguration>
```

4. On Properties > Static website hosting, choose "Use this bucket to host a website"
   - Set "index.html" as the index document, even though you won't be using one. (Can't save otherwise).

#### CloudFront

1. Create a distribution, mode "Web".
   - Origin domain name: select your S3 name: `tiles.terria.io.s3.amazonaws.com`
   - Scroll down, "Alternate domain names (CNAMEs)": `tiles.terria.io`
   - SSL Certificate: "Custom SSL Certificate", choose terria.io's certificate.
2. On "Behaviors", edit the existing behaviour.
3. Change "Cache based on Selected Request Headers" to "Whitelist"
   - Add these to whitelist:
     - Access-Control-Request-Headers
     - Access-Control-Request-Method
     - Origin
4. Set Object Caching to "Customize".
5. Set Maximum TTL and default TTL to 120.

#### Route 53: create subdomain

1. Go to Hosted zones, terria.io
2. Create a Record Set, `tiles.terria.io`
3. Check the Alias "Yes" box, find your Cloudfront distribution
