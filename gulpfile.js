const { series } = require('gulp');
const shell = require('shelljs');
shell.exec2 = require('shelljs.exec');
const fs = require('fs');
const tippecanoe = require('tippecanoe');
const mkdirp = require('mkdirp');
const ndjson = require('ndjson');
const jsonfile = require('jsonfile');
const json5 = require('json5');

const boundaryTypes = json5.parse(fs.readFileSync(process.env.BOUNDARYTYPESCONFIG || './config.json5'));

let activeBoundaryTypes = Object.keys(boundaryTypes);
if (process.env.BOUNDARYTYPES) {
    activeBoundaryTypes = process.env.BOUNDARYTYPES.split(',');
}

const srcDataDir = `./srcdata`;                 // where to find source zip files. Nothing written here
const tmpDir = `./tmp`;                         // where zip files are temporarily unzipped to
const geojsonDir = `./geojson`;                 // where generated newline-delimited GeoJSON files are written
const regionMappingDir = `./regionMapping`;     // where to find and update regionmapping file and write regionids files
const tesseraDir = `./tessera`;                 // where to find and update tessera_config.json
const tileHost = `tile-test.terria.io`;
const testCsvDir = './test';
const mbtilesDir = './mbtiles';

function throwIfFailed(shellStr) {
  if (shellStr.code !== 0) {
    throw new Error(`Shell execution failed. Details:\n${shellStr.stderr}`);
  }
}

async function toGeoJSON() {
    mkdirp(tmpDir);
    mkdirp(geojsonDir);
    for (let bt of activeBoundaryTypes) {
        const geojsonName = `${geojsonDir}/${bt}.nd.json`;
        shell.rm(`-f`, geojsonName);

        const srcDir = `${srcDataDir}/${bt}`;
        for (let zipName of Object.keys(boundaryTypes[bt].shapeNames)) {
            shell.rm(`-f`, `${tmpDir}/*`);
            throwIfFailed(shell.exec(`unzip -j ${srcDir}/${zipName} -d ${tmpDir}`));
            // ogr2ogr doesn't seem to work properly with `/dev/stdout`
            // .exec(...).toEnd(...) should work but truncates the file.

            let cmd = `ogr2ogr -t_srs EPSG:4326 -f GeoJSON /vsistdout "${tmpDir}/${boundaryTypes[bt].shapeNames[zipName]}" ` +
                `| npm run --silent geojson2ndjson ` +
                `>> ${geojsonName}`

            console.log(cmd);
            throwIfFailed(shell.exec(cmd, { silent: true }))
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
    mkdirp(mbtilesDir);
    for (let bt of activeBoundaryTypes) {
        const btOptions = boundaryTypes[bt].tippecanoeOptions || { maximumZoom: 12, minimumZoom: 0 };
        tippecanoe(
            [`${geojsonDir}/${bt}-fid.nd.json`],
            Object.assign({
                layer: bt,
                output: `${mbtilesDir}/${bt}.mbtiles`,
                force: true,
                readParallel: true,
                simplifyOnlyLowZooms: true,
                fullDetail: 32 - (btOptions.maximumZoom || 12),
                }, btOptions,
            ),
            { echo: true });
    }
    console.log('make vector tiles');
}

async function writeRegionMappingFile() {
    function regionMappingContent(env = 'prod') {
        const regionMapping = {
            regionWmsMap: {}
        };
        for (let  bt of activeBoundaryTypes) {
            const server = {
                prod: `https://${tileHost}/${bt}/{z}/{x}/{y}.pbf`,
                local: `http://localhost:4040/${bt}/{z}/{x}/{y}.pbf`
            }[env];
            const regionTypes = boundaryTypes[bt].regionTypes;
            const btOptions = boundaryTypes[bt].tippecanoeOptions || { };
            for (let rt of Object.keys(regionTypes)) {
                const regionMappingEntry = Object.assign({}, {
                    layerName: bt,
                    server: server,
                    serverType: 'MVT',
                    serverMaxNativeZoom: bt.maximumZoom || 12,
                    serverMinZoom: bt.minimumZoom || 0,
                    serverMaxZoom: 28,
                    regionIdsFile: `build/TerriaJS/data/regionids/region_map-${rt}_${bt}.json`,
                    // TODO bbox
                }, regionTypes[rt]);
                regionMapping.regionWmsMap[rt] = regionMappingEntry;
            }
        }
        return regionMapping;
    }
    mkdirp(regionMappingDir);
    fs.writeFileSync(`${regionMappingDir}/regionMapping.json`, JSON.stringify(regionMappingContent('prod'), null, 2));
    fs.writeFileSync(`${regionMappingDir}/regionMapping-local.json`, JSON.stringify(regionMappingContent('local'), null, 2));
}

function writeTestCsv(contents, bt, rt) {
    mkdirp(testCsvDir);
    const filename =`${testCsvDir}/${bt}_${rt}.csv`;
    const rows = [[rt, 'Value']];
    contents.values.forEach(val => {
        const select = true; // Math.random() > 0.8
        if (select) {
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

// async function updateTessera() {
//     mkdirp(tesseraDir);
//     const configFile = `./${tesseraDir}/tessera_config.json`;
//     const config = await jsonfile.readFile(configFile).catch(e => ({}));
//     for (let  bt of activeBoundaryTypes) {
//         const mbtilesFile = `data/${bt}.mbtiles`;
//         config[`/${bt}`] = {
//             source: `mbtiles:///etc/vector-tiles/${mbtilesFile}`,
//             headers: {
//                 'Cache-Control': 'public,max-age=86400'
//             }
//         }
//     }
//     await jsonfile.writeFile(configFile, config, { spaces: 2 });
// }

// Writes some local config files for running a Tessera instance in development. Not needed for production.
async function writeTessera() {
    mkdirp(mbtilesDir);
    for (let  bt of activeBoundaryTypes) {
        const config = {
            [`/${bt}`]: {
                source: `mbtiles://./${mbtilesDir}/${bt}.mbtiles`,
            }
        };
        await jsonfile.writeFile(`${mbtilesDir}/${bt}_tessera.json`, config, { spaces: 2 });
    }
}


async function deploy() {
    function getProgress(stats, progress) {
        // rewrites over the same line.
        process.stdout.write(`\r${progress.transferred} tiles, ${Math.round(progress.percentage)}% (${progress.runtime}s)`);
    }

    const userConfig = require('./userconfig.json');

    const response = throwIfFailed(shell.exec(`aws sts assume-role --role-arn ${userConfig.role_arn} --role-session-name upload-tiles --profile ${userConfig.profile}`, { silent: true }));
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
            tileCopy(`${mbtilesDir}/${bt}.mbtiles`, `s3://${tileHost}/${bt}/{z}/{x}/{y}.pbf?timeout=20000`, { progress: getProgress }, (d) => {
                if (d !== undefined) {
                    console.log(d);
                }
                resolve();
            })
        );
    }
}

console.log('Boundary-tiles: generates vector tiles from boundary files.');
console.log('To limit boundary types to be processed:   ');
console.log('  $ BOUNDARYTYPES=SED_2018,CED_2018 gulp all');

exports.makeVectorTiles = makeVectorTiles;
exports.toGeoJSON = toGeoJSON;
exports.writeRegionMappingFile = writeRegionMappingFile;
exports.makeRegionIds = makeRegionIds;
exports.addFeatureIds = addFeatureIds;
exports.writeTessera = writeTessera;
// exports.updateTessera = updateTessera;
exports.deploy = deploy;

exports.updateRegionMapping = series(makeRegionIds, writeRegionMappingFile);

exports.all = series(toGeoJSON, addFeatureIds, makeRegionIds, makeVectorTiles, exports.updateRegionMapping);
// exports.default = series(toGeoJSON, addFeatureIds, makeRegionIds, makeVectorTiles, exports.updateRegionMapping);
