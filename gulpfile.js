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
            //https://www.aec.gov.au/electorates/gis/index.htm
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
                aliases: ['com_elb_name','com_elb_name_2019'],
                description: 'Federal electoral divisions for 2019 election (AEC)',
                bbox: [96.82, -43.74, 159.11, -9.14 ],
                // optional extra props get passed straight through to regionMapping.json
                // uniqueIdProp
                // disambigProp
                // disambigRegionId
                // regionDisambigIdsFile
            }
        }
    }, CED_2018: {
        tippecanoeOptions: {
            minimumZoom: 0,
            maximumZoom: 12,
            // maximumZoom: 12 // required
        }, shapeNames: {
            // http://www.abs.gov.au/ausstats/subscriber.nsf/log?openagent&1270055003_ced_2018_aust_shp.zip&1270.0.55.003&Data%20Cubes&BF4D23C712D492CFCA2582F600180556&0&July%202018&28.08.2018&Latest
            '1270055003_ced_2018_aust_shp.zip': 'CED_2018_AUST.shp',
            
        }, regionTypes: {
            CED_CODE18: {
                regionProp: 'CED_CODE18',
                nameProp: 'CED_NAME18',
                aliases: ['ced', 'ced_code', 'ced_2018', 'ced_code_2018', 'ced_code18'],
                description: 'Commonwealth electoral divisions 2018 by code (ABS)',
                bbox: [96.82, -43.74, 159.11, -9.14 ],
                digits: 3
            },
            CED_NAME18: {
                regionProp: 'CED_NAME18',
                nameProp: 'CED_NAME18',
                aliases: ['ced_name', 'ced_name_2018', 'ced_name18'],
                description: 'Commonwealth electoral divisions 2018 by name (ABS)',
                bbox: [96.82, -43.74, 159.11, -9.14 ],
            },
        }
    }, SED_2018: {
        shapeNames: {
            '1270055003_sed_2018_aust_shp.zip': 'SED_2018_AUST.shp'
        },  regionTypes: {
            SED_CODE18: {
                regionProp: 'SED_CODE18',
                nameProp: 'SED_NAME18',
                aliases: ['sed', 'sed_code', 'sed_2018', 'sed_code_2018', 'sed_code18'],
                description: 'State electoral divisions 2018 by code (ABS)',
                bbox: [96.82, -43.74, 159.11, -9.14 ],
            },
            SED_NAME18: {
                regionProp: 'SED_NAME18',
                nameProp: 'SED_NAME18',
                aliases: ['sed_name', 'sed_name_2018', 'sed_name18'],
                description: 'State electoral divisions 2018 by code (ABS)',
                bbox: [96.82, -43.74, 159.11, -9.14 ],
            },
        }
    }, SED_2016: {
        shapeNames: {
            '1270055003_sed_2016_aust_shp.zip': 'SED_2016_AUST.shp'
        },  regionTypes: {
            SED_CODE16: {
                regionProp: 'SED_CODE16',
                nameProp: 'SED_NAME16',
                aliases: ['sed_2016', 'sed_code_2016', 'sed_code16'],
                description: 'State electoral divisions 2016 by code (ABS)',
                bbox: [96.82, -43.74, 159.11, -9.14 ],
            },
            SED_NAME16: {
                regionProp: 'SED_NAME16',
                nameProp: 'SED_NAME16',
                aliases: ['sed_name_2016', 'sed_name16'],
                description: 'State electoral divisions 2016 by code (ABS)',
                bbox: [96.82, -43.74, 159.11, -9.14 ],
            },
        }
    }
}

let activeBoundaryTypes = Object.keys(boundaryTypes);
if (process.env.BOUNDARYTYPES) {
    activeBoundaryTypes = process.env.BOUNDARYTYPES.split(',');
}

const srcDataDir = `./srcdata`;                 // where to find source zip files. Nothing written here
const tmpDir = `./tmp`;                         // where zip files are temporarily unzipped to
const geojsonDir = `./geojson`;                 // where generated newline-delimited GeoJSON files are written
const regionMappingDir = `./regionMapping`;     // where to find and update regionmapping file and write regionids files
const tesseraDir = `./tessera`;                 // where to find and update tessera_config.json
const tileHost = `tiles.terria.io`;
const testCsvDir = './test';
const mbtilesDir = './mbtiles';

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
