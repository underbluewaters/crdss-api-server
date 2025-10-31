export async function buildAttributes(get, all) {
    const versionResult = await get(`
    SELECT max(version) as version FROM versions
    `, []);
    if (!versionResult?.version) {
        throw new Error("No version found");
    }
    const version = versionResult.version;
    const columns = await all(`
    SELECT
    column_name,
    data_type
    FROM information_schema.columns
    WHERE table_name = 'cells' and column_name not like 'r%_id' and column_name not like 'Hex_%' and column_name not like 'Shape_%' and column_name != 'id_1'
    ORDER BY ordinal_position;
    `, []);
    let attributes = [];
    for (const column of columns) {
        switch (column.data_type) {
            case 'BOOLEAN':
                attributes.push(await getBooleanDetails(column.column_name, all));
                break;
            case 'VARCHAR':
                attributes.push(await getStringDetails(column.column_name, all));
                break;
            case 'BIGINT':
            case 'DOUBLE':
                attributes.push(await getNumericDetails(column.column_name, all));
                break;
            default:
                attributes.push({
                    key: column.column_name,
                    count: 0,
                    countDistinct: 0,
                    attribute: column.column_name,
                    type: toType(column.data_type),
                });
                break;
        }
    }
    return {
        version,
        attributes
    };
}
function toType(data_type) {
    if (data_type === 'BIGINT') {
        return 'number';
    }
    else if (data_type === 'VARCHAR') {
        return 'string';
    }
    else if (data_type === 'BOOLEAN') {
        return 'boolean';
    }
    else {
        return 'mixed';
    }
}
async function getBooleanDetails(columnName, all) {
    const results = await all(`
    select ${columnName} as value, count(*)::integer as count from cells group by ${columnName}
  `, []);
    const values = results.reduce((acc, result) => {
        acc[result.value] = result.count;
        return acc;
    }, {});
    console.log('results', values);
    let count = 0;
    for (const record of results) {
        count += record.count;
    }
    return {
        key: columnName,
        count,
        countDistinct: Object.keys(values).length,
        attribute: columnName,
        type: 'boolean',
        values
    };
}
async function getStringDetails(columnName, all) {
    if (columnName === "id") {
        const countDistinctResult = await all(`
      select count(distinct(id))::integer as count from cells
    `, []);
        const countDistinct = countDistinctResult[0].count;
        return {
            key: columnName,
            count: countDistinct,
            countDistinct,
            attribute: columnName,
            type: 'string',
        };
    }
    const results = await all(`
    select ${columnName} as value, count(*)::integer as count from cells group by ${columnName}
  `, []);
    let values = {};
    for (const record of results) {
        if (record.value !== null) {
            values[record.value] = record.count;
        }
    }
    let count = 0;
    for (const record of results) {
        count += record.value !== null ? record.count : 0;
    }
    return {
        key: columnName,
        count,
        countDistinct: Object.keys(values).length,
        attribute: columnName,
        type: 'string',
        values
    };
}
async function getNumericDetails(columnName, all) {
    const results = await all(`
    select count(${columnName})::integer, count(distinct ${columnName})::integer as countDistinct, min(${columnName})::double as min, max(${columnName})::double as max, stddev_samp(${columnName})::double as stddev, avg(${columnName})::double as avg from cells where ${columnName} is not null
  `, []);
    const { count, countDistinct, min, max, stddev, avg } = results[0];
    const histogramRows = await all(`
    select bin::integer as bin, bin_start::double as bin_start, bin_end::double as bin_end, count::integer as count from hist_eq_ew(${columnName}, 49)
  `, []);
    const histogram = histogramRows.map((row) => [row.bin_start, row.count]);
    histogram.push([histogramRows[histogramRows.length - 1].bin_end, null]);
    return {
        key: columnName,
        count,
        countDistinct,
        min,
        max,
        stats: {
            avg,
            stddev,
            equalInterval: [],
            naturalBreaks: [],
            quantiles: [],
            geometricInterval: [],
            standardDeviations: [],
            histogram,
        },
        attribute: columnName,
        type: 'number',
    };
}
