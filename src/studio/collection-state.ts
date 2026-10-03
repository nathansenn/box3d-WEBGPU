/** Bounded, validated local preferences. Presets remain useful when storage is unavailable. */
export interface CollectionState {version:1;favorites:string[];recent:string[]}
export const COLLECTION_KEY='box3d.studio.collection.v1';
export function readCollection(raw:string|null,allowed:ReadonlySet<string>):CollectionState {
  const empty:CollectionState={version:1,favorites:[],recent:[]};
  try {
    const value:unknown=JSON.parse(raw??'null');
    if(!value||typeof value!=='object'||!('version' in value)||value.version!==1)return empty;
    const clean=(v:unknown,max:number)=>Array.isArray(v)?[...new Set(v.filter((id):id is string=>typeof id==='string'&&allowed.has(id)))].slice(0,max):[];
    return {version:1,favorites:clean('favorites' in value?value.favorites:null,200),recent:clean('recent' in value?value.recent:null,24)};
  } catch {return empty;}
}
export function toggleFavorite(state:CollectionState,id:string):CollectionState {
  return {...state,favorites:state.favorites.includes(id)?state.favorites.filter(x=>x!==id):[id,...state.favorites].slice(0,200)};
}
export function rememberPreset(state:CollectionState,id:string):CollectionState {
  return {...state,recent:[id,...state.recent.filter(x=>x!==id)].slice(0,24)};
}
