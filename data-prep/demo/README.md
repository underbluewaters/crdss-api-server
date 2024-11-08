# Demonstration Dataset Scripts

During initial project exploration, I didn't have access to a set of annotated
h3 cells to work with, but I did have access to the original 200m grid dataset
and the footprints of each study region. This set of scripts will:

1. Create a set of h3 cells at high resolution (~50m, or resolution 11)
   covering the entire study area
2. Join these cells with data values from the 200m grid dataset, either using
   matching values from overlapping areas or by choosing a random cell where
   no related cells exist in the smaller, 200m region
3. Represent this dataset similarly to what would be expected to be sent by
   the NOVA Southeastern team for the final production dataset. Currently
   that being a CSV file with an id column filled with the h3 cell identifier.
