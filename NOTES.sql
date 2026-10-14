CREATE OR REPLACE MACRO hist_eq_ew(col, n) AS TABLE (
    WITH stats AS (
      SELECT MIN(col) AS min_v, MAX(col) AS max_v
      FROM cells
      WHERE col IS NOT NULL
    ),
    bp AS (
      SELECT min_v, max_v, (max_v - min_v) / CAST(n AS DOUBLE) AS w
      FROM stats
    ),
    assigned AS (
      SELECT CASE
        WHEN bp.max_v IS NULL OR bp.min_v IS NULL THEN NULL
        WHEN bp.max_v = bp.min_v THEN n
        WHEN col = bp.max_v THEN n
        ELSE 1 + CAST(FLOOR((col - bp.min_v) / bp.w) AS INT)
      END AS bin
      FROM cells, bp
      WHERE col IS NOT NULL
    ),
    counts AS (
      SELECT bin, COUNT(*) AS bin_count
      FROM assigned
      WHERE bin IS NOT NULL
      GROUP BY bin
    )
    SELECT
      b AS bin,
      bp.min_v + (b - 1) * bp.w AS bin_start,
      CASE WHEN b = n THEN bp.max_v ELSE bp.min_v + b * bp.w END AS bin_end,
      COALESCE(c.bin_count, 0) AS count
    FROM bp, range(1, n + 1) r(b)
    LEFT JOIN counts c ON c.bin = b
    ORDER BY b
  );

SELECT * FROM hist_eq_ew(InletDist_km, 49);

SELECT
    column_name,
    data_type
  FROM information_schema.columns
  WHERE table_name = 'cells' and column_name not like 'r%_id' and column_name not like 'Hex_%' and column_name not like 'Shape_%' and column_name != 'id' and column_name != 'id_1'
  ORDER BY ordinal_position;

select AquaticPres, count(AquaticPres) from cells group by AquaticPres;

-- ---------------------------------------------------------------------------
-- Backfill BCG scores from bcgTemp into cells (cells.id = bcgTemp.GRID_ID)
-- Run these in order from the DuckDB CLI. Source columns are VARCHAR; target
-- columns are DOUBLE — validate before updating.
-- ---------------------------------------------------------------------------

-- 1) Duplicate GRID_ID in bcgTemp would make the UPDATE non-deterministic.
--    Expect zero rows:
SELECT GRID_ID, COUNT(*) AS n
FROM bcgTemp
GROUP BY GRID_ID
HAVING COUNT(*) > 1;

-- 2) Rows in bcgTemp that cannot cast to DOUBLE (fix source data if any rows):
SELECT GRID_ID, Max_BCG_Score, Min_BCG_Score
FROM bcgTemp
WHERE (Max_BCG_Score IS NOT NULL AND TRY_CAST(Max_BCG_Score AS DOUBLE) IS NULL)
   OR (Min_BCG_Score IS NOT NULL AND TRY_CAST(Min_BCG_Score AS DOUBLE) IS NULL);

-- 3) Optional: how many cells rows will get a match (sanity check):
SELECT
  COUNT(*) FILTER (WHERE b.GRID_ID IS NOT NULL) AS cells_with_bcg_match,
  COUNT(*) AS cells_total
FROM cells c
LEFT JOIN bcgTemp b ON c.id = b.GRID_ID;

-- 4) Apply update (atomic). Uncomment after steps 1–3 look good:
BEGIN TRANSACTION;
UPDATE cells
SET
  BCG_Score_Max = CAST(b.Max_BCG_Score AS DOUBLE),
  BCG_Score_Min = CAST(b.Min_BCG_Score AS DOUBLE)
FROM bcgTemp AS b
WHERE cells.id = b.GRID_ID;
COMMIT;

-- If you prefer NULL on bad strings instead of failing the whole statement,
-- replace CAST with TRY_CAST in the SET clause and re-run step 2 afterward
-- to find rows that ended up NULL unexpectedly.

