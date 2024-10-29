import { stops, zoomToH3Resolution } from "./stops.js";
import * as h3 from "h3-js";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { timing, startTime, endTime } from "hono/timing";
import tilebelt from "@mapbox/tilebelt";
import duckdb from "duckdb";
import vtpbf from "vt-pbf";
import geojsonVt from "geojson-vt";
import { readFileSync } from "fs";
const emptyTileBuffer = createEmptyTileBuffer();
const db = new duckdb.Database(process.env.DUCKDB_PATH);
const connection = db.connect();
connection.all("install h3 from community; load h3", (err, data) => {
    if (err) {
        console.error(err);
    }
    else {
        console.log("h3 loaded");
        connection.all("install spatial; load spatial", (err, data) => {
            if (err) {
                console.error(err);
            }
            else {
                console.log("spatial loaded");
            }
        });
    }
});
const attrString = readFileSync(process.env.ATTRIBUTES_PATH, "utf8").toString();
const attributeData = JSON.parse(attrString);
const app = new Hono();
app.use(timing());
app.use(logger());
app.use("/*", cors());
app.get("/:v/mvt/:z/:x/:y", async (c, next) => {
    const z = parseInt(c.req.param("z"));
    const x = parseInt(c.req.param("x"));
    const y = parseInt(c.req.param("y"));
    const version = c.req.param("version");
    const format = c.req.query("format") || "pbf";
    const filter = c.req.query("filter");
    const resolution = zoomToH3Resolution(z, stops);
    const f = parseFilters(filter);
    const where = buildWhereClauses(f || {}, 3);
    const query = `
    with tile_members as (
      select
        distinct(id),
      from
        geohashes
      where
        resolution = $1 and
        geohash like $2
    )
    select
      distinct(h3_h3_to_string(r${resolution}_id)) as id,
      count(h3_h3_to_string(r${resolution}_id))::int as count
    from
      cells
    where
      r${resolution}_id in (select id from tile_members) and
      ${where.values.length > 0 ? where.where : "true"}
    group by r${resolution}_id
  `;
    const values = [resolution, `${tilebelt.tileToQuadkey([x, y, z])}%`];
    if (where.values.length > 0) {
        values.push(...where.values);
    }
    startTime(c, "db");
    const result = await all(query, values);
    endTime(c, "db");
    if (result.length === 0) {
        if (format === "geojson") {
            return c.json({
                type: "FeatureCollection",
                features: [],
            });
        }
        else {
            c.header("Content-Type", "application/x-protobuf");
            // set immutable cache headers
            c.header("Cache-Control", "public, max-age=31536000, immutable");
            return c.body(emptyTileBuffer);
        }
    }
    const fc = {
        type: "FeatureCollection",
        features: result.map((row) => ({
            type: "Feature",
            properties: {
                highlighted: true,
                h3: row.id,
                count: row.count,
                resolution,
            },
            geometry: {
                type: "Polygon",
                coordinates: h3.cellsToMultiPolygon([row.id], true)[0],
            },
        })),
    };
    startTime(c, "pbf");
    const tileindex = geojsonVt(fc);
    const tile = tileindex.getTile(z, x, y);
    var buff = vtpbf.fromGeojsonVt({ cells: tile });
    endTime(c, "pbf");
    if (format === "geojson") {
        return c.json(fc);
    }
    else {
        c.header("Content-Type", "application/x-protobuf");
        // set immutable cache headers
        c.header("Cache-Control", "public, max-age=31536000, immutable");
        return c.body(buff);
    }
});
app.get("/metadata", async (c) => {
    return c.json(attributeData);
});
app.get("/count", async (c) => {
    const f = parseFilters(c.req.query("filter"));
    const where = buildWhereClauses(f || {}, 1);
    const query = `
    select
      count(distinct(id))::int as count
    from
      cells
    where
      ${where.values.length > 0 ? where.where : "true"}
  `;
    const values = where.values;
    startTime(c, "db");
    const result = await get(query, values);
    endTime(c, "db");
    return c.json(result);
});
app.onError((err, c) => {
    console.error(`${err}`);
    return c.text("Custom Error Message", 500);
});
function isNumberFilter(filter) {
    return (filter.min !== undefined ||
        filter.max !== undefined);
}
function isBooleanFilter(filter) {
    return filter.bool !== undefined;
}
function isStringFilter(filter) {
    return filter.choices !== undefined;
}
function buildWhereClauses(filters, valueStartIndex = 4) {
    const whereClauses = [];
    const values = [];
    for (const [column, filter] of Object.entries(filters)) {
        if (isNumberFilter(filter)) {
            if ("min" in filter && "max" in filter) {
                whereClauses.push(`${column} >= $${valueStartIndex} AND ${column} <= $${valueStartIndex + 1}`);
                values.push(filter.min, filter.max);
                valueStartIndex += 2;
            }
            else if ("min" in filter) {
                whereClauses.push(`${column} >= $${valueStartIndex}`);
                values.push(filter.min);
                valueStartIndex++;
            }
            else if ("max" in filter) {
                whereClauses.push(`${column} <= $${valueStartIndex}`);
                values.push(filter.max);
                valueStartIndex++;
            }
        }
        else if (isBooleanFilter(filter)) {
            whereClauses.push(`${column} = $${valueStartIndex}`);
            values.push(filter.bool);
            valueStartIndex++;
        }
        else if (isStringFilter(filter) && filter.choices.length > 0) {
            whereClauses.push(`${column} IN (${filter.choices
                .map((_, i) => `$${valueStartIndex + i}`)
                .join(", ")})`);
            values.push(...filter.choices);
            valueStartIndex += filter.choices.length;
        }
        else {
            console.error("Invalid filter", filter);
        }
    }
    if (whereClauses.length === 0) {
        return { where: "", values: [] };
    }
    else {
        return { where: whereClauses.join(" AND "), values };
    }
}
function get(query, values = []) {
    return new Promise((resolve, reject) => {
        connection.all(query, ...values, (err, data) => {
            if (err) {
                reject(err);
            }
            else if (data && data.length > 0) {
                resolve(data[0]);
            }
            else {
                reject(new Error("No data returned from query"));
            }
        });
    });
}
function all(query, values = []) {
    return new Promise((resolve, reject) => {
        connection.all(query, ...values, (err, data) => {
            if (err) {
                reject(err);
            }
            else if (data) {
                resolve(data);
            }
            else {
                reject(new Error("No data returned from query"));
            }
        });
    });
}
function parseFilters(filters) {
    if (!filters) {
        return null;
    }
    try {
        const parsed = JSON.parse(decodeURIComponent(filters));
        if (typeof parsed === "object") {
            return parsed;
        }
        else {
            return null;
        }
    }
    catch (e) {
        console.error(e);
        return null;
    }
}
function createEmptyTileBuffer() {
    const index = geojsonVt({
        type: "FeatureCollection",
        features: [
            {
                type: "Feature",
                properties: {},
                geometry: {
                    type: "Polygon",
                    coordinates: [
                        [
                            [-81.9336880175533, 24.532357165118],
                            [-81.9377015564132, 24.5349778311727],
                            [-81.9420523013835, 24.532796637661],
                            [-81.9423890725121, 24.5279947373529],
                            [-81.938375407226, 24.5253743322599],
                            [-81.9340250972132, 24.5275555665127],
                            [-81.9336880175533, 24.532357165118],
                        ],
                    ],
                },
            },
        ],
    });
    const tile = index.getTile(0, 0, 0);
    tile.features = [];
    tile.numPoints = 0;
    tile.numFeatures = 0;
    tile.source = [];
    const buffer = vtpbf.fromGeojsonVt({ cells: tile });
    return buffer;
}
export default app;
