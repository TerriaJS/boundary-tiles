const { series } = require("gulp");
const shell = require("shelljs");
shell.exec2 = require("shelljs.exec");
const fs = require("fs");
const tippecanoe = require("tippecanoe");
const mkdirp = require("mkdirp");
const ndjson = require("ndjson");
const json5 = require("json5");

const boundaryTypes = json5.parse(
  fs.readFileSync(process.env.BOUNDARYTYPESCONFIG || "./config.json5")
);

let activeBoundaryTypes = Object.keys(boundaryTypes);
if (process.env.BOUNDARYTYPES) {
  activeBoundaryTypes = process.env.BOUNDARYTYPES.split(",");
}

const srcDataDir = `./srcdata`; // where to find source zip files. Nothing written here
const tmpDir = `./tmp`; // where zip files are temporarily unzipped to
const geojsonDir = `./geojson`; // where generated newline-delimited GeoJSON files are written
const regionMappingDir = `./regionMapping`; // where to find and update regionmapping file and write regionids files
const tileHost = `tiles.terria.io`;
const testCsvDir = "./test";
const mbtilesDir = "./mbtiles";

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

    if (boundaryTypes[bt].sharedGeopackage) {
      // Pull 1 layer from ASGS geopackage with many region types
      const { zip, gpkg, layerName } = boundaryTypes[bt].sharedGeopackage;
      if (!(zip && gpkg && layerName))
        throw new Error("Must define zip, gpkg and layerName");
      const srcDir = `${srcDataDir}/geopackages`;
      shell.rm(`-f`, `${tmpDir}/*`);
      throwIfFailed(shell.exec(`unzip -j ${srcDir}/${zip} -d ${tmpDir}`));

      let cmd =
        `ogr2ogr -t_srs EPSG:4326 -f GeoJSON /vsistdout "${tmpDir}/${gpkg}" ${layerName}` +
        `| yarn run --silent geojson2ndjson ` +
        `>> ${geojsonName}`;

      console.log(cmd);
      throwIfFailed(shell.exec(cmd, { silent: true }));
    } else {
      // Use 1 or more shapefiles to assmeble 1 region type
      const srcDir = `${srcDataDir}/${bt}`;
      for (let zipName of Object.keys(boundaryTypes[bt].shapeNames)) {
        shell.rm(`-f`, `${tmpDir}/*`);
        throwIfFailed(shell.exec(`unzip -j ${srcDir}/${zipName} -d ${tmpDir}`));
        // ogr2ogr doesn't seem to work properly with `/dev/stdout`
        // .exec(...).toEnd(...) should work but truncates the file.

        let cmd =
          `ogr2ogr -t_srs EPSG:4326 -f GeoJSON /vsistdout "${tmpDir}/${boundaryTypes[bt].shapeNames[zipName]}" ` +
          `| yarn run --silent geojson2ndjson ` +
          `>> ${geojsonName}`;

        console.log(cmd);
        throwIfFailed(shell.exec(cmd, { silent: true }));
      }
    }
  }
}

async function addFeatureIds() {
  // d is the feature, i is the numerical index. ", d" is to return the feature itself from the map
  for (let bt of activeBoundaryTypes) {
    await new Promise((resolve, reject) => {
      const fidField = boundaryTypes[bt].uniqueIdProp || "FID";
      const inStream = fs
        .createReadStream(`${geojsonDir}/${bt}.nd.json`)
        .pipe(ndjson.parse());
      const outStream = fs.createWriteStream(`${geojsonDir}/${bt}-fid.nd.json`);
      let fid = 0;
      let count = 0;
      // alternatively:
      // shell.exec(`ndjson-map "d.properties['${fidField}']=i, d" < ${geojsonDir}/${bt}.nd.json > ${geojsonDir}/${bt}-fid.nd.json`);
      inStream
        .on("data", (feature) => {
          feature.properties[fidField] = fid++;
          outStream.write(JSON.stringify(feature) + "\n");
          count++;
        })
        .on("end", () => {
          console.log(`Added ${count} feature IDs.`);
          resolve();
        });
    });
  }
}

async function makeVectorTiles() {
  mkdirp(mbtilesDir);
  for (let bt of activeBoundaryTypes) {
    const btOptions = boundaryTypes[bt].tippecanoeOptions || {
      maximumZoom: 12,
      minimumZoom: 0,
    };
    tippecanoe(
      [`${geojsonDir}/${bt}-fid.nd.json`],
      Object.assign(
        {
          layer: bt,
          force: true,
          outputToDirectory: `${mbtilesDir}/${bt}/`,
          // Mapbox will compress .pbf files if not set to true
          // This isn't compatibly with protomaps
          noTileCompression: true,
          noTileSizeLimit: true,
          readParallel: true,
          simplifyOnlyLowZooms: true,
          fullDetail: 32 - (btOptions.maximumZoom || 12),
        },
        btOptions
      ),
      { echo: true }
    );
  }
  console.log("make vector tiles");
}

async function writeRegionMappingFile() {
  function regionMappingContent(env = "prod") {
    const regionMapping = {
      regionWmsMap: {},
    };
    for (let bt of activeBoundaryTypes) {
      const server = {
        prod: `https://${tileHost}/${bt}/{z}/{x}/{y}.pbf`,
        local: `http://localhost:3000/mbtiles/${bt}/{z}/{x}/{y}.pbf`,
      }[env];

      const regionTypes = boundaryTypes[bt].regionTypes;

      for (let rt of Object.keys(regionTypes)) {
        const regionIdsFile = {
          prod: `build/TerriaJS/data/regionids/region_map-${rt}.json`,
          local: `http://localhost:3000/regionMapping/regionids/region_map-${rt}.json`,
        }[env];

        const regionMappingEntry = Object.assign(
          {},
          {
            layerName: bt,
            server: server,
            serverType: "MVT",
            serverMaxNativeZoom: bt.maximumZoom || 12,
            serverMinZoom: bt.minimumZoom || 0,
            serverMaxZoom: 28,
            regionIdsFile,
            uniqueIdProp: "FID",
            // TODO bbox
          },
          regionTypes[rt]
        );
        regionMapping.regionWmsMap[rt] = regionMappingEntry;
      }
    }
    return regionMapping;
  }
  mkdirp(regionMappingDir);
  fs.writeFileSync(
    `${regionMappingDir}/regionMapping.json`,
    JSON.stringify(regionMappingContent("prod"), null, 2)
  );
  fs.writeFileSync(
    `${regionMappingDir}/regionMapping-local.json`,
    JSON.stringify(regionMappingContent("local"), null, 2)
  );
}

function writeTestCsv(contents, bt, rt, alias) {
  mkdirp(testCsvDir);
  const filename = `${testCsvDir}/${bt}_${rt}.csv`;
  const rows = [[alias, "Value"]];
  contents.values.forEach((val) => {
    const select = true; // Math.random() > 0.8
    if (select) {
      rows.push([val, Math.round(Math.random() * 100)]);
    }
  });
  fs.writeFileSync(filename, rows.map((row) => row.join(",")).join("\n"));
  console.log(`Wrote ${rows.length} rows to ${filename}.`);
}

async function regionIdsContents(bt, rt) {
  let values = [];
  const regionTypes = boundaryTypes[bt].regionTypes;
  const fidField = regionTypes[rt].uniqueIdProp || "FID";
  const valueField = regionTypes[rt].regionProp;
  const stream = fs
    .createReadStream(`${geojsonDir}/${bt}-fid.nd.json`)
    .pipe(ndjson.parse());
  return new Promise((resolve, reject) => {
    stream
      .on("data", (feature) => {
        const fid = feature.properties[fidField];
        // this handles the case where features aren't sorted by fid
        values[fid] = feature.properties[valueField];
      })
      .on("end", () => {
        resolve({
          layer: bt,
          property: valueField,
          values,
        });
      });
  });
}

async function makeRegionIds() {
  mkdirp("regionMapping/regionids");
  for (let bt of activeBoundaryTypes) {
    const regionTypes = boundaryTypes[bt].regionTypes;

    for (let rt of Object.keys(regionTypes)) {
      const contents = await regionIdsContents(bt, rt); // TODO make parallel
      if (
        regionTypes[rt].aliases !== undefined &&
        regionTypes[rt].aliases.length > 0
      )
        writeTestCsv(contents, bt, rt, regionTypes[rt].aliases[0]);

      const filename = `regionMapping/regionids/region_map-${rt}.json`;
      fs.writeFileSync(filename, JSON.stringify(contents));

      console.log(`Wrote ${contents.values.length} regionIds to ${filename}`);
    }
  }
}

async function previewInTerria() {
  const json = {
    homeCamera: {
      north: -8,
      east: 158,
      south: -45,
      west: 109,
    },
    workbench: [],
    catalog: [],
  };

  for (let bt of activeBoundaryTypes) {
    json.catalog.push({
      layer: bt,
      url: `http://localhost:3000/mbtiles/${bt}/{z}/{x}/{y}.pbf`,
      id: bt,
      name: bt,
      fillColor: "#fdc086",
      lineColor: "#7570b3",
      type: "mvt",
    });
    json.workbench.push(bt);
  }

  console.log("\nServing entire `boundary-tiles` directory on port 3000!\n");

  console.log(
    `Preview URL:\n\nhttp://ci.terria.io/main/#clean&start=${JSON.stringify({
      version: "8.0.0",
      initSources: [json],
    })}\n`
  );

  throwIfFailed(shell.exec("./node_modules/.bin/serve --cors"));
}

console.log("Boundary-tiles: generates vector tiles from boundary files.");
console.log("To limit boundary types to be processed:   ");
console.log("  $ BOUNDARYTYPES=SED_2018,CED_2018 gulp all");

exports.makeVectorTiles = makeVectorTiles;
exports.toGeoJSON = toGeoJSON;
exports.writeRegionMappingFile = writeRegionMappingFile;
exports.makeRegionIds = makeRegionIds;
exports.addFeatureIds = addFeatureIds;
exports.previewInTerria = previewInTerria;

exports.updateRegionMapping = series(makeRegionIds, writeRegionMappingFile);

exports.all = series(
  toGeoJSON,
  addFeatureIds,
  makeVectorTiles,
  exports.updateRegionMapping
);
