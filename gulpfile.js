const { series } = require('gulp');
const shell = require('shelljs');
const fs = require('fs');
const tippecanoe = require('tippecanoe');
const mkdirp = require('mkdirp');
const ndjson = require('ndjson');
const jsonfile = require('jsonfile');

const boundaryTypes = {
    ELB_2018: {
        tippecanoeOptions: {
            minimumZoom: 2,
            maximumZoom: 12 // required
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
            ELB_NAME_2018: {
                regionProp: 'Sortname', // TODO normalise caps for NSW
                nameProp: 'Sortname',
                aliases: ['elb'],
                description: 'Federal electoral divisions for 2019 election (AEC)',
                //uniqueIdProp
            }
        }
    }    
}

let activeBoundaryTypes=['ELB_2018']; // TODO or environment variable
const tmpDir = `./tmp`;
const geojsonDir = `./geojson`;

async function toGeoJSON() {
    mkdirp(tmpDir);
    mkdirp(geojsonDir);
    for (let bt of activeBoundaryTypes) {
        const geojsonName = `${geojsonDir}/${bt}.nd.json`;
        shell.rm(`-f`, geojsonName);
            
        const srcDir = `srcdata/${bt}`;
        for (let zipName of Object.keys(boundaryTypes[bt].shapeNames)) {
            shell.rm(`-f`, `${tmpDir}/*`);
            shell.exec(`unzip -j ${srcDir}/${zipName} -d ${tmpDir}`, { silent: true });
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
            inStream.on('data', feature => {
                feature.properties[fidField] = fid ++;
                outStream.write(JSON.stringify(feature) + '\n');
            }).on('end', resolve);

            // HERE
            shell.exec(`ndjson-map "d.properties['${fidField}']=i, d" < ${geojsonDir}/${bt}.nd.json > ${geojsonDir}/${bt}-fid.nd.json`);
        });
    }

}

async function makeVectorTiles() {
    mkdirp('mbtiles');
    for (let bt of activeBoundaryTypes) {
        const btOptions = boundaryTypes[bt].tippecanoeOptions;
        tippecanoe([`${geojsonDir}/${bt}.nd.json`], {
            layer: bt,
            output: `./mbtiles/${bt}.mbtiles`,
            force: true,
            readParallel: true,
            simplifyOnlyLowZooms: true,
            fullDetail: 32 - btOptions.maximumZoom,
            ...btOptions,
        }, { echo: true });
    }
    console.log('make vector tiles');
}

async function updateRegionMapping() {
    mkdirp('regionMapping');
    const regionMapping = {
        regionWmsMap: {}
    };
    for (let  bt of activeBoundaryTypes) {
        const regionTypes = Object.keys(boundaryTypes[bt].regionTypes);
        for (let rt of regionTypes) {
            const regionMappingEntry = {
                layerName: bt,
                server: `https://vector-tiles.terria.io/${bt}/{z}/{x}/{y}.pbf`,
                serverType: 'MVT',
                serverMaxNativeZoom: boundaryTypes[bt].tippecanoeOptions.maximumZoom,
                serverMinZoom: boundaryTypes[bt].tippecanoeOptions.minimumZoom,
                regionIdsFile: `build/TerriaJS/data/regionids/region_map-${rt}_${bt}.json`,
                // TODO bbox
                ...regionTypes[rt]
            }

            regionMapping.regionWmsMap[bt] = regionMappingEntry;
        }
    }
    fs.writeFileSync(`regionMapping/regionMapping.json`, JSON.stringify(regionMapping, null, 2));
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
    for (let  bt of activeBoundaryTypes) {
        const regionTypes = boundaryTypes[bt].regionTypes;
        
        for (let rt of Object.keys(regionTypes)) {
            mkdirp('regionMapping/regionids');
            const contents = await regionIdsContents(bt, rt); // TODO make parallel
            fs.writeFileSync(`regionMapping/regionids/region_map-${rt}_${bt}.json`, JSON.stringify(contents));
        }
    }
}

async function updateTessera() {
    mkdirp('tessera');
    const configFile = './tessera/tessera_config.json';
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


async function defaultTask() {
    console.log('default!');
}
  
exports.makeVectorTiles = makeVectorTiles;
exports.toGeoJSON = toGeoJSON;
exports.updateRegionMapping = updateRegionMapping;
exports.makeRegionIds = makeRegionIds;
exports.addFeatureIds = addFeatureIds;
exports.updateTessera = updateTessera;

exports.default = series(toGeoJSON, addFeatureIds, makeRegionIds, makeVectorTiles, updateRegionMapping, updateTessera);
