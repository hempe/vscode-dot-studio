
// Branded type for NodeId strings to provide type safety
declare const __nodeIdBrand: unique symbol;
export type NodeIdString = { readonly [__nodeIdBrand]: true } & string;