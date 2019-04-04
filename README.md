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
* `deploy`: uploads the invidiual tiles from the `mbtiles` file to S3. You will need your MFA device.

### Configuration

To use the `gulp deploy` script, first create a `userconfig.json` file in this directory, as follows:

```
{
    "role_arn": "arn:aws:iam::123457890:role/owner",
    "profile": "terria"
}
```

You can find the correct values in your ~/.aws/config file.


### Setting up AWS

Setting up AWS to serve vector tiles directly from S3 requires three main bits: 

* an S3 bucket configured as a static website, with CORS enabled
* a Route53 subdomain pointing at it
* a CloudFront distribution pointing to the subdomain, with certificate and CORS settings


#### S3: Create bucket

1. Name it according to the subdomain you will use, eg `tiles.terria.io`
   * Region: Asia Pacific (Sydney)
   * Uncheck all four "Manage public access control lists (ACLs) for this bucket" and "Manage public bucket policies for this bucket" options
2. In the bucket, Permissions > Bucket Policy, paste this (updating the bucket name):

```
 {
   "Version":"2012-10-17",
   "Statement":[{
     "Sid":"PublicReadForGetBucketObjects",
         "Effect":"Allow",
       "Principal": "*",
       "Action":["s3:GetObject"],
       "Resource":["arn:aws:s3:::tiles.terria.io/*"
       ]
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

4. On Properties > Static website hosting, choose "Use this bucket to host a website"
  * Set "index.html" as the index document, even though you won't be using one. (Can't save otherwise).

```

#### CloudFront

1. Create a distribution, mode "Web".
  *  Origin domain name: select your S3 name: `tiles.terria.io.s3.amazonaws.com`
  * Scroll down, "Alternate domain names (CNAMEs)": `tiles.terria.io`
  * SSL Certificate: "Custom SSL Certificate", choose terria.io's certificate.
2. On "Behaviors", edit the existing behaviour.
3. Change "Cache based on Selected Request Headers" to "Whitelist"
  * Add these to whitelist:
    - Access-Control-Request-Headers
    - Access-Control-Request-Method
    - Origin
4. Set Object Caching to "Customize".
5. Set Maximum TTL and default TTL to 120.


#### Route 53: create subdomain

1. Go to Hosted zones, terria.io
2. Create a Record Set, `tiles.terria.io`
3. Check the Alias "Yes" box, find your Cloudfront distribution
