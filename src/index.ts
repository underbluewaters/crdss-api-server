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
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'

const emptyTileBuffer = createEmptyTileBuffer();

const db = new duckdb.Database(process.env.DUCKDB_PATH);
const connection = db.connect();
connection.all("install h3 from community; load h3", (err: any, data: any) => {
  if (err) {
    console.error(err);
  } else {
    console.log("h3 loaded");
    connection.all("install spatial; load spatial", (err: any, data: any) => {
      if (err) {
        console.error(err);
      } else {
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
  const result = await all<{ id: string; count: number }>(query, values);
  endTime(c, "db");
  if (result.length === 0) {
    if (format === "geojson") {
      return c.json({
        type: "FeatureCollection",
        features: [],
      });
    } else {
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
  } else {
    c.header("Content-Type", "application/x-protobuf");
    // set immutable cache headers
    c.header("Cache-Control", "public, max-age=31536000, immutable");
    return c.body(buff);
  }
});

app.get("/metadata", async (c) => {
  c.header("Cache-Control", "public, max-age=900");
  return c.json(attributeData);
});

app.get("/count", async (c) => {
  const f = parseFilters(c.req.query("filter"));
  const where = buildWhereClauses(f || {}, 1);
  const query = `
    select
      count(distinct(r11_id))::int as count
    from
      cells
    where
      ${where.values.length > 0 ? where.where : "true"}
  `;
  const values = where.values;
  startTime(c, "db");
  const result = await get<{ count: number }>(query, values);
  endTime(c, "db");
  return c.json(result);
});

app.onError((err, c) => {
  console.error(`${err}`);
  return c.text("Custom Error Message", 500);
});

type NumberFilter = {
  min?: number;
  max?: number;
};

type BooleanFilter = {
  bool: boolean;
};

type StringFilter = {
  choices: string[];
};

type Filter = NumberFilter | BooleanFilter | StringFilter;

function isNumberFilter(filter: Filter): filter is NumberFilter {
  return (
    (filter as NumberFilter).min !== undefined ||
    (filter as NumberFilter).max !== undefined
  );
}

function isBooleanFilter(filter: Filter): filter is BooleanFilter {
  return (filter as BooleanFilter).bool !== undefined;
}

function isStringFilter(filter: Filter): filter is StringFilter {
  return (filter as StringFilter).choices !== undefined;
}

function buildWhereClauses(
  filters: { [column: string]: Filter },
  valueStartIndex = 4
): { where: string; values: any[] } {
  const whereClauses: string[] = [];
  const values: any[] = [];
  for (const [column, filter] of Object.entries(filters)) {
    if (isNumberFilter(filter)) {
      if ("min" in filter && "max" in filter) {
        whereClauses.push(
          `${column} >= $${valueStartIndex} AND ${column} <= $${valueStartIndex + 1
          }`
        );
        values.push(filter.min, filter.max);
        valueStartIndex += 2;
      } else if ("min" in filter) {
        whereClauses.push(`${column} >= $${valueStartIndex}`);
        values.push(filter.min);
        valueStartIndex++;
      } else if ("max" in filter) {
        whereClauses.push(`${column} <= $${valueStartIndex}`);
        values.push(filter.max);
        valueStartIndex++;
      }
    } else if (isBooleanFilter(filter)) {
      whereClauses.push(`${column} = $${valueStartIndex}`);
      values.push(filter.bool);
      valueStartIndex++;
    } else if (isStringFilter(filter) && filter.choices.length > 0) {
      whereClauses.push(
        `${column} IN (${filter.choices
          .map((_, i) => `$${valueStartIndex + i}`)
          .join(", ")})`
      );
      values.push(...filter.choices);
      valueStartIndex += filter.choices.length;
    } else {
      console.error("Invalid filter", filter);
    }
  }
  if (whereClauses.length === 0) {
    return { where: "", values: [] };
  } else {
    return { where: whereClauses.join(" AND "), values };
  }
}

function get<T>(query: string, values: any[] = []): Promise<T> {
  return new Promise((resolve, reject) => {
    connection.all(query, ...values, (err: any, data: any) => {
      if (err) {
        reject(err);
      } else if (data && data.length > 0) {
        resolve(data[0] as T);
      } else {
        reject(new Error("No data returned from query"));
      }
    });
  });
}

function all<T>(query: string, values: any[] = []): Promise<T[]> {
  return new Promise((resolve, reject) => {
    connection.all(query, ...values, (err: any, data: any) => {
      if (err) {
        reject(err);
      } else if (data) {
        resolve(data as T[]);
      } else {
        reject(new Error("No data returned from query"));
      }
    });
  });
}

function parseFilters(filters?: string): { [column: string]: Filter } | null {
  if (!filters) {
    return null;
  }
  try {
    const parsed = JSON.parse(decodeURIComponent(filters));
    if (typeof parsed === "object") {
      return parsed;
    } else {
      return null;
    }
  } catch (e) {
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
  const tile = index.getTile(0, 0, 0)!;
  tile.features = [];
  tile.numPoints = 0;
  tile.numFeatures = 0;
  tile.source = [];
  const buffer = vtpbf.fromGeojsonVt({ cells: tile });
  return buffer;
}

const statsQuerySchema = z.object({
  cells: z.array(z.string()).nonempty().max(5000),
  properties: z.array(z.object({
    type: z.enum(["number", "string", "boolean"]),
    column: z.string(),
  })).nonempty().max(5)
});

const numberPropertyResultSchema = z.object({
  property: z.string(),
  type: z.literal("number"),
  min: z.number(),
  max: z.number(),
  avg: z.number(),
});

type NumberPropertyResult = z.infer<typeof numberPropertyResultSchema>;

const stringPropertyResultSchema = z.object({
  property: z.string(),
  type: z.literal("string"),
  counts: z.array(z.object({
    value: z.string(),
    count: z.number(),
  }))
});

const booleanPropertyResultSchema = z.object({
  property: z.string(),
  type: z.literal("boolean"),
  counts: z.array(z.object({
    value: z.boolean(),
    count: z.number(),
  }))
});

const statsResultsSchema = z.union([
  numberPropertyResultSchema,
  stringPropertyResultSchema,
  booleanPropertyResultSchema
]);

type StatsResults = z.infer<typeof statsResultsSchema>[];

app.post("/stats", zValidator("json", statsQuerySchema), async (c) => {
  const { cells, properties } = c.req.valid("json");
  const uncompacted = h3.uncompactCells(cells, 11);
  const results: StatsResults = [];
  const cte = `
  with filtered_cells as (
    select
      *
    from
      cells
    where
      id IN (
        SELECT id FROM (VALUES 
          ${uncompacted.map((id) => `('${id}')`).join(", ")}
        ) AS v(id)
      )
    )`;
  for (const property of properties) {
    const attr = attributeData.attributes.find((a: {attribute: string}) => a.attribute === property.column);
    if (!attr) {
      c.text(`Attribute ${property.column} not found`, 400);
    }
    if (property.column)
    if (property.type === "number") {
      const query = `
        ${cte}
        select
          min(${property.column}) as min,
          max(${property.column}) as max,
          avg(${property.column}) as avg
        from
          filtered_cells
      `;
      startTime(c, `query ${property.column}`);
      const result = await get<{ min: number, max: number, avg: number }>(query);
      endTime(c, `query ${property.column}`);
      results.push({
        type: "number",
        property: property.column,
        min: result.min,
        max: result.max,
        avg: result.avg,
      });
    } else if (property.type === "string") {
      const query = `
        ${cte}
        select
          ${property.column} as value,
          count(${property.column}) as count
        from
          filtered_cells
        group by ${property.column}
      `;
      console.time('query');
      const result = await all<{ value: string, count: number }>(query);
      console.timeEnd('query');
      results.push({
        type: "string",
        property: property.column,
        counts: result.map((row) => ({
          count: row.count,
          value: row.value,
        }))
      });
    }
  }
  return c.json(results);
  // return c.json({
  //   foo: "bar"
  // })
});


export default app;
