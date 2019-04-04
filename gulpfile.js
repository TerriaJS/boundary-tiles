const { series } = require('gulp');
const shell = require('shelljs');
shell.exec2 = require('shelljs.exec');
const fs = require('fs');
const tippecanoe = require('tippecanoe');
const mkdirp = require('mkdirp');
const ndjson = require('ndjson');
const jsonfile = require('jsonfile');
const boundaryTypes = {
    ELB_2019: {
        tippecanoeOptions: {
            minimumZoom: 0,
            maximumZoom: 12
            // maximumZoom: 12 // required
        }, shapeNames: {
            'act-july-2018-esri.zip': 'E_ACT_18_region.shp',
            'nsw-esri-06042016.zip': 'NSW_electoral_boundaries_25-02-2016.shp',
            'nt-esri-07022017.zip': 'E_Propos_region.shp',
            'qld-march-2018-esri.zip': 'E_AUGEC_region.shp',
            'sa-july-2018-esri.zip': 'E_FINAL_region.shp',
            'tas-november-2017-esri.zip': 'E_FINAL_region.shp',
            'vic-july-2018-esri.zip': 'E_AUGFN3_region.shp',
            'wa-esri-19012016.zip':'WA_Electoral_Boundaries_19-01-2016.shp'
        }, regionTypes: {
            ELB_NAME_2019: {
                regionProp: 'Sortname', // TODO normalise caps for NSW
                nameProp: 'Sortname',
                aliases: ['elb','elb_name'],
                description: 'Federal electoral divisions for 2019 election (AEC)',
                "bbox": [
                    96.81694140799998,
                    -43.74050960300003,
                    159.10921900799997,
                    -9.142175976999999
                ],
                // optional extra props get passed straight through to regionMapping.json
                // uniqueIdProp
                // disambigProp
                // disambigRegionId
                // regionDisambigIdsFile
            }
        }
    }    
}

let activeBoundaryTypes = Object.keys(boundaryTypes); // TODO or environment variable
if (process.env.BOUNDARYTYPES) {
    activeBoundaryTypes = process.env.BOUNDARYTYPES.split(',');
}

const srcDataDir = `./srcdata`;                     // where to find source zip files. Nothing written here
const tmpDir = `./tmp`;                         // where zip files are temporarily unzipped to
const geojsonDir = `./geojson`;                 // where generated newline-delimited GeoJSON files are written
const regionMappingDir = `./regionMapping`;     // where to find and update regionmapping file and write regionids files
const tesseraDir = `./tessera`;                 // where to find and update tessera_config.json
const tileHost = `tiles.terria.io`;
const testCsvDir = './test';

async function toGeoJSON() {
    mkdirp(tmpDir);
    mkdirp(geojsonDir);
    for (let bt of activeBoundaryTypes) {
        const geojsonName = `${geojsonDir}/${bt}.nd.json`;
        shell.rm(`-f`, geojsonName);
            
        const srcDir = `${srcDataDir}/${bt}`;
        for (let zipName of Object.keys(boundaryTypes[bt].shapeNames)) {
            shell.rm(`-f`, `${tmpDir}/*`);
            shell.exec(`unzip -j ${srcDir}/${zipName} -d ${tmpDir}`);//, { silent: true });
            // ogr2ogr doesn't seem to work properly with `/dev/stdout`
            // .exec(...).toEnd(...) should work but truncates the file.
            
            let cmd = `ogr2ogr -t_srs EPSG:4326 -f GeoJSON /vsistdout "${tmpDir}/${boundaryTypes[bt].shapeNames[zipName]}" ` +
                `| geojson2ndjson ` +
                `>> ${geojsonName}`
            
            console.log(cmd);
            shell.exec(cmd, { silent: true })
        }
    }
}

async function addFeatureIds() {
    // d is the feature, i is the numerical index. ", d" is to return the feature itself from the map
    for (let bt of activeBoundaryTypes) {
        await new Promise((resolve, reject) => {
            const fidField = boundaryTypes[bt].uniqueIdProp || 'FID';
            const inStream = fs.createReadStream(`${geojsonDir}/${bt}.nd.json`).pipe(ndjson.parse());
            const outStream = fs.createWriteStream(`${geojsonDir}/${bt}-fid.nd.json`);
            let fid = 0;
            let count=0;
            // alternatively: 
            // shell.exec(`ndjson-map "d.properties['${fidField}']=i, d" < ${geojsonDir}/${bt}.nd.json > ${geojsonDir}/${bt}-fid.nd.json`);
            inStream.on('data', feature => {
                feature.properties[fidField] = fid ++;
                outStream.write(JSON.stringify(feature) + '\n');
                count++;
            }).on('end', () => {
                console.log(`Added ${count} feature IDs.`);
                resolve();
            });

        
            
        });
    }

}

async function makeVectorTiles() {
    mkdirp('mbtiles');
    for (let bt of activeBoundaryTypes) {
        const btOptions = boundaryTypes[bt].tippecanoeOptions;
        tippecanoe(
            [`${geojsonDir}/${bt}-fid.nd.json`], 
            Object.assign({
                layer: bt,
                output: `./mbtiles/${bt}.mbtiles`,
                force: true,
                readParallel: true,
                simplifyOnlyLowZooms: true,
                fullDetail: 32 - btOptions.maximumZoom,
                }, btOptions,
            ), 
            { echo: true });
    }
    console.log('make vector tiles');
}

async function updateRegionMapping() {
    mkdirp(regionMappingDir);
    const regionMapping = {
        regionWmsMap: {}
    };
    for (let  bt of activeBoundaryTypes) {
        const regionTypes = boundaryTypes[bt].regionTypes;
        for (let rt of Object.keys(regionTypes)) {
            console.log(regionTypes);
            const regionMappingEntry = Object.assign({}, {
                layerName: bt,
                server: `https://${tileHost}/${bt}/{z}/{x}/{y}.pbf`,
                serverType: 'MVT',
                serverMaxNativeZoom: boundaryTypes[bt].tippecanoeOptions.maximumZoom,
                serverMinZoom: boundaryTypes[bt].tippecanoeOptions.minimumZoom,
                regionIdsFile: `build/TerriaJS/data/regionids/region_map-${rt}_${bt}.json`,
                // TODO bbox
            }, regionTypes[rt]);            
            regionMapping.regionWmsMap[bt] = regionMappingEntry;
        }
    }
    fs.writeFileSync(`${regionMappingDir}/regionMapping.json`, JSON.stringify(regionMapping, null, 2));
}

function writeTestCsv(contents, bt, rt) {
    mkdirp(testCsvDir);
    const filename =`${testCsvDir}/${bt}_${rt}.csv`;
    const rows = [[rt, 'Value']];
    contents.values.forEach(val => {
        if (Math.random() > 0.8) {
            rows.push([val, Math.round(Math.random() * 100)]);
        }
    });
    fs.writeFileSync(filename, rows.map(row => row.join(',')).join('\n'));
    console.log(`Wrote ${rows.length} rows to ${filename}.`);
}

async function regionIdsContents(bt, rt) {
    let values = [];
    const regionTypes = boundaryTypes[bt].regionTypes;
    const fidField = regionTypes[rt].uniqueIdProp || 'FID';
    const valueField = regionTypes[rt].regionProp;
    const stream = fs.createReadStream(`${geojsonDir}/${bt}-fid.nd.json`).pipe(ndjson.parse());
    return new Promise((resolve, reject) => {
        stream.on('data', feature => {
            const fid = feature.properties[fidField];
            // this handles the case where features aren't sorted by fid
            values[fid] = feature.properties[valueField]; 
        }).on('end', () => {
            resolve({
                layer: bt,
                property: valueField,
                values
            });
        })
    });     
}

async function makeRegionIds() { 
    mkdirp('regionMapping/regionids');
    for (let bt of activeBoundaryTypes) {
        const regionTypes = boundaryTypes[bt].regionTypes;
        
        for (let rt of Object.keys(regionTypes)) {
            const contents = await regionIdsContents(bt, rt); // TODO make parallel
            writeTestCsv(contents, bt, rt)
            
            const filename = `regionMapping/regionids/region_map-${rt}_${bt}.json`;
            fs.writeFileSync(filename, JSON.stringify(contents));
            
            console.log(`Wrote ${contents.values.length} regionIds to ${filename}`);
        }
    }
}

async function updateTessera() {
    mkdirp(tesseraDir);
    const configFile = `./${tesseraDir}/tessera_config.json`;
    const config = await jsonfile.readFile(configFile).catch(e => ({}));
    for (let  bt of activeBoundaryTypes) {
        const mbtilesFile = `data/${bt}.mbtiles`;
        config[`/${bt}`] = {
            source: `mbtiles:///etc/vector-tiles/${mbtilesFile}`,
            headers: { 
                'Cache-Control': 'public,max-age=86400'
            }
        }
    }
    await jsonfile.writeFile(configFile, config, { spaces: 2 });
}

async function deploy() {
    function getProgress(stats, progress) {
        // rewrites over the same line.
        process.stdout.write(`\r${progress.transferred} tiles, ${Math.round(progress.percentage)}% (${progress.runtime}s)`);
    }

    const userConfig = require('./userconfig.json');

    const response = shell.exec(`aws sts assume-role --role-arn ${userConfig.role_arn} --role-session-name upload-tiles --profile ${userConfig.profile}`, { silent: true });
    if (response.stderr) {
        console.error(response.stderr);
    }
    const creds = JSON.parse(response.stdout).Credentials;
    if (creds) {
        console.log('AWS Session token acquired.');
    }
    process.env.AWS_ACCESS_KEY_ID = creds.AccessKeyId;
    process.env.AWS_SECRET_ACCESS_KEY = creds.SecretAccessKey;
    process.env.AWS_SESSION_TOKEN = creds.SessionToken;

    // console.log(`AWS_ACCESS_KEY_ID=${process.env.AWS_ACCESS_KEY_ID}`)
    // console.log(`AWS_SECRET_ACCESS_KEY=${process.env.AWS_SECRET_ACCESS_KEY}`);
    // console.log(`AWS_SESSION_TOKEN=${process.env.AWS_SESSION_TOKEN}`);

    for (let bt of activeBoundaryTypes) {
        const tileCopy = require('@mapbox/mapbox-tile-copy');
        console.log(''); // clear space before progress output
        
        // alternative method: shell.exec(`mapbox-tile-copy  mbtiles/${bt}.mbtiles s3://tile-test.terria.io/${bt}/{z}/{x}/{y}.pbf`);
        return new Promise((resolve, reject) => 
            tileCopy(`mbtiles/${bt}.mbtiles`, `s3://${tileHost}/${bt}/{z}/{x}/{y}.pbf?timeout=20000`, { progress: getProgress }, (d) => {
                if (d !== undefined) {
                    console.log(d);
                }
                resolve();
            })
        );
    }
}
  
exports.makeVectorTiles = makeVectorTiles;
exports.toGeoJSON = toGeoJSON;
exports.updateRegionMapping = updateRegionMapping;
exports.makeRegionIds = makeRegionIds;
exports.addFeatureIds = addFeatureIds;
exports.updateTessera = updateTessera;
exports.deploy = deploy;

exports.default = series(toGeoJSON, addFeatureIds, makeRegionIds, makeVectorTiles, updateRegionMapping, updateTessera);
