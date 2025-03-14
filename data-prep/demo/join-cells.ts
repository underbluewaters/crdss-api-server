/**
 * This script facilitates joining properties from a cells.csv file with a set
 * of H3 cells IDs.
 *
 * In the original MarinePlanner, there was a 200m grid and I have that original
 * dataset. It's relatively straightforward to get the h3 cell id for a low
 * resolution (r9) based on the centroid of these square grid cells. This
 * results in a CSV file with an h3 index (id), and a bunch of other columns.
 * This data source can be found in ./output/200m-cells.csv
 *
 * The goal with this script is to then join the low-resolution properties in
 * 200m-cells.csv with a higher resolution (r11) grid for the new tool, which
 * covers a larger footprint.
 *
 * Usage: npx ts-node join-cells.ts <output/path.csv> <input/cells.csv>
 */
import { readFileSync, createWriteStream, createReadStream } from "node:fs";
import * as Papa from "papaparse";
import * as h3 from "h3-js";
// @ts-ignore
import cliProgress from "cli-progress";

const usage = `
Usage: npx ts-node join-cells.ts <output/path.csv> <input/cells.csv>
`;

// Get output file path (should be first argument)
const filePath = process.argv[2];
if (!filePath) {
  console.error("Usage: npx ts-node join-cells.ts <output/path.csv>");
  process.exit(1);
}

// Input cells.csv file should be second argument
const cellsPath = process.argv[3];
if (!cellsPath) {
  console.error("Please provide a path to input cells csv file");
  process.exit(1);
}

// Initialize progress bar
const progressBar = new cliProgress.SingleBar(
  {
    format:
      "Progress | {bar} | {percentage}% || {value}/{total} cells processed || ETA: {eta_formatted}",
    barCompleteChar: "\u2588",
    barIncompleteChar: "\u2591",
    hideCursor: true,
  },
  cliProgress.Presets.shades_classic
);

const dataToJoin = readFileSync("./200m-cells.csv", "utf-8");
const data = Papa.parse<{ id: string } | any>(dataToJoin, { header: true });
const lookup = new Map<string, any>();
const RESOLUTION = h3.getResolution(data.data[0].id);
data.data.forEach((row: any) => {
  lookup.set(row.id, row);
});

const header = dataToJoin.slice(0, 10000).split("\n")[0];

const output = createWriteStream(filePath);
output.write(header);

// Read cells.csv as a stream and join each row
const stream = createReadStream(cellsPath);

let i = 0;
let totalCells = 0;

// Pre-process to get the total number of cells
Papa.parse(stream, {
  header: false,
  step: () => {
    totalCells++;
  },
  complete: () => {
    // Reset the stream for the actual parsing
    const cellStream = createReadStream(cellsPath);

    // Start progress bar
    progressBar.start(totalCells, 0);

    Papa.parse(cellStream, {
      header: false,
      dynamicTyping: true,
      step: (row: any) => {
        i++;
        if (i % 1000 === 0) {
          progressBar.update(i);
        }
        const id = row.data[0].toString();
        const joinId = h3.cellToParent(id, RESOLUTION);
        const joined = lookup.get(joinId);
        if (joined) {
          output.write("\n");
          output.write(id);
          for (const key in joined) {
            if (key !== "id" && key !== "__parsed_extra") {
              output.write(",");
              output.write(joined[key]);
            }
          }
        } else {
          // Get a random cell to join with
          const random =
            data.data[Math.floor(Math.random() * data.data.length)];
          output.write("\n");
          output.write(id);
          for (const key in random) {
            if (key !== "id" && key !== "__parsed_extra") {
              output.write(",");
              output.write(random[key]);
            }
          }
        }
      },
      complete: () => {
        output.write("\n");
        output.end();
        progressBar.update(totalCells);
        progressBar.stop();
        console.log(
          `Wrote ${i.toLocaleString()} joined cells to output/joined-cells.csv`
        );
      },
      error: (err) => {
        console.error(err);
        process.exit(1);
      },
    });
  },
});
