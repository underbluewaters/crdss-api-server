/**
 * build-attributes-json.ts Takes an input CSV file containing properties for h3
 * cells and generates a "geostats" JSON file similar to what SeaSketch uses for
 * data layer uploads. It identifies (and counts occurances of) unique values,
 * min/max values for numbers, and information needed to generate a histograms
 * in the filtering interface.
 */

import generateGeostats from "./src/generateGeostats";
import { writeFileSync } from "node:fs";

const filePath = process.argv[2];

if (!filePath) {
  console.error("Please provide a file path");
  process.exit(1);
}

generateGeostats(filePath).then((attributes) => {
  console.log('done building attributes. Writing to file...')
  // write json to output/attributes.json
  writeFileSync("data/attributes.json", JSON.stringify(attributes, null, 2));
  console.log("attributes.json written to data/attributes.json");
});
