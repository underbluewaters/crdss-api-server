declare module 'vt-pbf' {
  export function fromGeojsonVt(tileIndex: any, options?: any): any;
  export function toGeojsonVt(data: any, options?: any): any;
}

declare module 'geojson-vt' {
  interface Options {
    maxZoom?: number;
    indexMaxZoom?: number;
    indexMaxPoints?: number;
    tolerance?: number;
    extent?: number;
    buffer?: number;
    lineMetrics?: boolean;
    promoteId?: null | string | ((props: any) => any);
    generateId?: boolean;
    debug?: number;
  }

  interface Tile {
    features: any[];
    numPoints: number;
    numSimplified: number;
    numFeatures: number;
    z2: number;
    transformed: boolean;
    min: [number, number];
    max: [number, number];
    source: any;
    x: number;
    y: number;
    z: number;
  }

  export default function geojsonvt(data: any, options?: Options): {
    getTile(z: number, x: number, y: number): Tile | null;
  };
}

declare module '@mapbox/tilebelt' {
  export function pointToTile(lon: number, lat: number, z: number): [number, number, number];
  export function pointToTileFraction(lon: number, lat: number, z: number): [number, number, number];
  export function tileToBBOX(tile: [number, number, number]): [number, number, number, number];
  export function tileToGeoJSON(tile: [number, number, number]): GeoJSON.Feature<GeoJSON.Geometry>;
  export function getParent(tile: [number, number, number]): [number, number, number];
  export function getSiblings(tile: [number, number, number]): [number, number, number][];
  export function hasSiblings(tile: [number, number, number], tiles: [number, number, number][]): boolean;
  export function getChildren(tile: [number, number, number]): [number, number, number][];
  export function bboxToTile(bbox: [number, number, number, number]): [number, number, number];
  export function bboxToTiles(bbox: [number, number, number, number], zoom: number): [number, number, number][];
  export function tilesEqual(tile1: [number, number, number], tile2: [number, number, number]): boolean;
  export function tileToQuadkey(tile: [number, number, number]): string;
}

declare namespace NodeJS {
  interface ProcessEnv {
    NODE_ENV: 'development' | 'production' | 'test';
    DUCKDB_PATH: string;
    ATTRIBUTES_PATH: string;
  }
}

// Provided by tsx at runtime; add type to silence TS error
interface ImportMeta {
  main?: boolean;
}