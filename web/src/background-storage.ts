import type {BackgroundId} from './background-catalog.js';

const dbName='dffb-authorized-backgrounds';
const storeName='images';
const dbVersion=1;

function openDatabase():Promise<IDBDatabase> {
  return new Promise((resolve,reject)=>{
    if (typeof indexedDB==='undefined') {reject(new Error('This browser does not support offline artwork storage'));return;}
    const request=indexedDB.open(dbName,dbVersion);
    request.onupgradeneeded=()=>{if (!request.result.objectStoreNames.contains(storeName))request.result.createObjectStore(storeName);};
    request.onerror=()=>reject(request.error??new Error('Could not open artwork storage'));
    request.onsuccess=()=>resolve(request.result);
  });
}

async function transaction<T>(kind:IDBTransactionMode, work:(store:IDBObjectStore,resolve:(value:T)=>void,reject:(error:unknown)=>void)=>void):Promise<T>{
  const db=await openDatabase();
  try{return await new Promise<T>((resolve,reject)=>{
    const tx=db.transaction(storeName,kind);
    tx.oncomplete=()=>{};
    tx.onabort=()=>reject(tx.error??new Error('Artwork transaction aborted'));
    tx.onerror=()=>reject(tx.error??new Error('Artwork transaction failed'));
    work(tx.objectStore(storeName),resolve,reject);
  });}finally{db.close();}
}

export async function getCustomBackground(id:BackgroundId):Promise<Blob|null>{
  return transaction<Blob|null>('readonly',(store,resolve,reject)=>{
    const req=store.get(id);req.onsuccess=()=>resolve(req.result instanceof Blob?req.result:null);req.onerror=()=>reject(req.error);
  });
}
export async function setCustomBackground(id:BackgroundId,blob:Blob):Promise<void>{
  return transaction<void>('readwrite',(store,resolve,reject)=>{
    const req=store.put(blob,id);req.onsuccess=()=>resolve();req.onerror=()=>reject(req.error);
  });
}
export async function clearCustomBackground(id:BackgroundId):Promise<void>{
  return transaction<void>('readwrite',(store,resolve,reject)=>{
    const req=store.delete(id);req.onsuccess=()=>resolve();req.onerror=()=>reject(req.error);
  });
}
