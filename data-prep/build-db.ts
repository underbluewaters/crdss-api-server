/**
 * build-db.ts
 * This script prints instructions for how to create a duckdb database of cell
 * values from the duckdb cli. Initially this script performed all operations,
 * but it is much easier (and more performant) to just paste these commands
 * directly into the duckdb cli.
 */
const usage = `Please provide a path to the highest resolution cells.csv file.
Usage: npx ts-node build-db.ts path/to/cells.csv`;

// second argument should be a path to the highest resolution cells.csv file
const cellsPath = process.argv[2];
// ensure argument is passed
if (!cellsPath) {
  console.error(usage);
  process.exit(1);
}

console.log("DuckDB can be created directly from the CSV file");
console.log(`
To do so, run the following from the duckdb cli:

$ duckdb ./output/crdss.duckdb

load h3;
load spatial;

CREATE or replace macro close_polygon_wkt(geom) AS (
  -- Extract the coordinates part of the WKT
  CASE
    WHEN geom LIKE 'POLYGON%' THEN
      'POLYGON((' ||
      TRIM(BOTH '()' FROM SPLIT_PART(geom, '((', 2)) || ', ' ||
      TRIM(SPLIT_PART(SPLIT_PART(geom, '((', 2), ',', 1)) || '))'
    ELSE geom
  END
);

CREATE or REPLACE MACRO polygon_from_multipolygon_wkt(wkt) as (
   st_astext((unnest(st_dump(st_geomfromtext(wkt)))).geom)
);

CREATE or REPLACE MACRO h3_id_to_simple_polygon(id) as (
  st_geomfromtext(close_polygon_wkt(polygon_from_multipolygon_wkt(h3_cells_to_multi_polygon_wkt(array_value(id)))))
);

CREATE TABLE temp1 AS 
  SELECT * FROM read_csv('${cellsPath}', 
    header = true, 
    null_padding = true
  );

-- Modify this statement as needed to drop columns or transform data, e.g. 
-- converting varchar columns to boolean

CREATE TABLE cells as
  select 
    h3_string_to_h3(id) as r11_id, 
    h3_cell_to_parent(h3_string_to_h3(id), 10) as r10_id,
    h3_cell_to_parent(h3_string_to_h3(id), 9) as r9_id,
    h3_cell_to_parent(h3_string_to_h3(id), 8) as r8_id,
    h3_cell_to_parent(h3_string_to_h3(id), 7) as r7_id,
    h3_cell_to_parent(h3_string_to_h3(id), 6) as r6_id,
    h3_cell_to_parent(h3_string_to_h3(id), 5) as r5_id,
    h3_cell_to_parent(h3_string_to_h3(id), 4) as r4_id,
    * 
  from temp1;

-- If you modified the previous statement, you will need to create a new csv
-- file for feeding into build-attributes-json.ts

DROP TABLE temp1;

Don't forget to run:
npx tsx ./data-prep/add-geohashes.ts -d ./data/crdss.duckdb
`);

process.exit();
