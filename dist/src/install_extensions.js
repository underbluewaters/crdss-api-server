import duckdb from "duckdb";
const db = new duckdb.Database(process.env.DUCKDB_PATH);
const connection = db.connect();
connection.all("install h3 from community; load h3", (err, data) => {
    if (err) {
        console.error(err);
    }
    else {
        console.log("h3 extension installed", data);
        connection.all("install spatial; load spatial", (err, data) => {
            if (err) {
                console.error(err);
            }
            else {
                console.log("spatial extension installed", data);
                connection.close();
            }
        });
    }
});
