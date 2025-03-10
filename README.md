# crdss-api-server
Filtering API for the FWC Coral Reef Decision Support System


## Local Development Setup

```sh
cd crdss-api-server/
nvm use .
npm install
# on mac, for others see https://duckdb.org/#quickinstall
brew install duckdb
# you will need to create and load your db, if it does not already exist
mkdir ./data
duckdb ./data/crdss.duckdb
> install h3 from community;
> load h3;
> install spatial;
> load spatial;
# load csv data. this will output some prepared statements to load data into 
# duckdb. Modify them as needed.
npx tsx data-prep/build-db.ts ~/Downloads/hex-grid-v1.csv
# generate geohashes
npx tsx ./data-prep/add-geohashes.ts -d ./data/crdss.duckdb
# create a csv file for feeding into build-attributes-json.ts
duckdb ./data/crdss.duckdb
D create table temp2 as select * from cells;
D alter table temp2 drop column r11_id;
D alter table temp2 drop column r10_id;
D alter table temp2 drop column r9_id;
D alter table temp2 drop column r8_id;
D alter table temp2 drop column r7_id;
D alter table temp2 drop column r6_id;
D alter table temp2 drop column r5_id;
D alter table temp2 drop column r4_id;
D COPY temp2 to './data/cells.csv' (FORMAT CSV, HEADER TRUE);
D drop table temp2;
# create attributes.json
npx tsx ./data-prep/build-attributes-json.ts ./data/cells.csv
# Modify attributes.json to set an appropriate version number
open ./data/attributes.json
# setup .env file
cp .env.template .env
# modify .env
source .env
npm start
```

## Deployment

Assuming the above steps have been performed to populate `./data`...

```sh
npm run build:container
# login to ecr. Make sure AWS_SECRET_ACCESS_KEY, etc are set first
aws ecr get-login-password \
 --region us-east-1 \
| docker login \
 --username AWS \
 --password-stdin 703671909637.dkr.ecr.us-east-1.amazonaws.com
# run deployment script
npm run deploy
# Sign into AWS console, create a new task definition, and update the service.
```