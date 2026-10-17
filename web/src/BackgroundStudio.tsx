/** Background authoring tool: import art, crop it to the stage, export a PNG to drop into
 * `web/public/battle-backgrounds/`.
 *
 * NOT CURRENTLY MOUNTED. Its only entry point was the `App.tsx` desktop harness, which has
 * been deleted. It is kept because the background feature is unfinished rather than
 * abandoned: no backdrop art ships yet, and `BattleStage` draws a flat colour with a ground
 * band instead. Reaching it again means mounting it behind a dev flag in `DailyBattle` and
 * teaching the stage's `background` draw case to load a bundled PNG. */
import {useEffect,useState} from 'react';
import {backgroundForBoss,battleBackgrounds,backgroundIds,bundledBackgroundUrl} from './background-catalog.js';
import type {BackgroundId} from './background-catalog.js';
import {clearCustomBackground,getCustomBackground,setCustomBackground} from './background-storage.js';

const base=import.meta.env.BASE_URL;

/** Layer with three priorities: user-imported art, bundled PNG, placeholder fallback. */
export function BattleBackdrop({bossId,refresh,onManage}:{bossId:string;refresh:number;onManage:()=>void}) {
  const id=backgroundForBoss(bossId);
  const [url,setUrl]=useState<string|null>(null);
  const [kind,setKind]=useState<'imported'|'bundled'|'missing'>('missing');
  useEffect(()=>{
    let alive=true;let objectUrl:string|undefined;
    const bundled=bundledBackgroundUrl(id,base);
    (async()=>{
      try{
        const blob=await getCustomBackground(id);
        if (!alive)return;
        if(blob){objectUrl=URL.createObjectURL(blob);setUrl(objectUrl);setKind('imported');return;}
      }catch{/* allow no-IndexedDB and private browsing: try bundled file */}
      if(!alive)return;
      // Vite emits web/public/** verbatim. Handle missing files explicitly.
      const probe=new Image();
      probe.onload=()=>{if(alive){setUrl(bundled);setKind('bundled');}};
      probe.onerror=()=>{if(alive){setUrl(null);setKind('missing');}};
      probe.src=bundled;
    })();
    return()=>{alive=false;if(objectUrl)URL.revokeObjectURL(objectUrl);};
  },[id,refresh]);
  const item=battleBackgrounds[id];
  return <>
    {url&&<img className="arena-background" src={url} alt={`${item.scene}: ${item.place}`} style={{imageRendering:item.imageRendering}}/>}
    <div className={`arena-backdrop-tint ${url?'has-art':''}`} aria-hidden="true"/>
    <button className="background-source-button" onClick={onManage} title="Manage battle scenery artwork">
      {kind==='missing'?'＋ ADD BACKGROUND ART':`▣ ${item.style} · ${kind==='bundled'?'BUNDLED':'LOCAL'}`}
    </button>
  </>;
}

type Crop={x:number;y:number;w:number;h:number};
function constrainCrop(raw:Crop,w:number,h:number):Crop {
  const x=Math.max(0,Math.min(w,raw.x)),y=Math.max(0,Math.min(h,raw.y));
  return {x,y,w:Math.max(1,Math.min(w-x,raw.w)),h:Math.max(1,Math.min(h-y,raw.h))};
}

export function BackgroundStudio({initialId,onClose,onChange}:{initialId:BackgroundId;onClose:()=>void;onChange:()=>void}) {
  const [id,setId]=useState<BackgroundId>(initialId);
  const [preview,setPreview]=useState<string|null>(null);
  const [crop,setCrop]=useState<Crop|null>(null);
  const [selection,setSelection]=useState<'whole'|'crop'>('whole');
  const [message,setMessage]=useState('Select a PNG, JPEG, or WebP battle background or art sheet.');
  const [imageSize,setImageSize]=useState<{w:number,h:number}>({w:0,h:0});
  const [selectionStart,setSelectionStart]=useState<{x:number,y:number}|null>(null);
  const [busy,setBusy]=useState(false);
  const info=battleBackgrounds[id];
  useEffect(()=>()=>{if(preview)URL.revokeObjectURL(preview);},[preview]);
  function point(e:{clientX:number;clientY:number;currentTarget:HTMLImageElement}){
    const img=e.currentTarget;const r=img.getBoundingClientRect();
    return {x:Math.round((e.clientX-r.left)/r.width*img.naturalWidth),y:Math.round((e.clientY-r.top)/r.height*img.naturalHeight)};
  }
  function begin(e:{clientX:number;clientY:number;pointerId:number;currentTarget:HTMLImageElement}){
    if(selection!=='crop')return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setSelectionStart(point(e));setCrop(null);
  }
  function move(e:{clientX:number;clientY:number;currentTarget:HTMLImageElement}){
    if(selection!=='crop'||!selectionStart)return;
    const a=selectionStart,b=point(e);
    const x=Math.min(a.x,b.x),y=Math.min(a.y,b.y);
    setCrop(constrainCrop({x,y,w:Math.max(1,Math.abs(b.x-a.x)),h:Math.max(1,Math.abs(b.y-a.y))},e.currentTarget.naturalWidth,e.currentTarget.naturalHeight));
  }
  function end(){setSelectionStart(null);}
  async function upload(file:File|undefined){
    if(!file)return;
    if(!['image/png','image/jpeg','image/webp'].includes(file.type)){setMessage('Please choose a PNG, JPEG, or WebP file.');return;}
    if(file.size>25_000_000){setMessage('Image is too large (25 MB maximum).');return;}
    setPreview(URL.createObjectURL(file));setCrop(null);setSelection('whole');setImageSize({w:0,h:0});setMessage(`Loaded ${file.name}. Choose Crop to isolate a battle background from a sprite sheet.`);
  }
  async function buildCroppedImage():Promise<{blob:Blob;width:number;height:number}>{
    const img=document.getElementById('source-image-preview') as HTMLImageElement|null;
    if(!preview||!img)throw new Error('Choose a valid image first.');
    {
      const bounds=selection==='crop'&&crop?crop:{x:0,y:0,w:img.naturalWidth,h:img.naturalHeight};
      if(selection==='crop'&&(!crop||crop.w<8||crop.h<8))throw new Error('Drag to select a larger background region first.');
      const canvas=document.createElement('canvas');
      canvas.width=bounds.w;canvas.height=bounds.h;
      const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Could not create image canvas.');
      ctx.imageSmoothingEnabled=false;
      ctx.drawImage(img,bounds.x,bounds.y,bounds.w,bounds.h,0,0,bounds.w,bounds.h);
      const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Image export failed')),'image/png'));
      return {blob,width:canvas.width,height:canvas.height};
    }
  }
  async function save(){
    setBusy(true);
    try{const image=await buildCroppedImage();await setCustomBackground(id,image.blob);onChange();setMessage(`Saved ${info.place} locally (${image.width} × ${image.height}). The battle now uses this artwork.`);}
    catch(e){setMessage(e instanceof Error?e.message:'Could not save the background.');}
    finally{setBusy(false);}
  }
  async function exportForBuild(){
    setBusy(true);
    try{const image=await buildCroppedImage();const url=URL.createObjectURL(image.blob);const anchor=document.createElement('a');anchor.href=url;anchor.download=info.file;anchor.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);setMessage(`Exported ${info.file}. Place this in web/public/battle-backgrounds/ for offline builds.`);}
    catch(e){setMessage(e instanceof Error?e.message:'Could not export artwork.');}
    finally{setBusy(false);}
  }
  async function remove(){
    setBusy(true);try{await clearCustomBackground(id);onChange();setMessage('Removed local override. If a bundled PNG exists, it will appear instead.');}
    catch(e){setMessage(e instanceof Error?e.message:'Could not remove background.');}
    finally{setBusy(false);}
  }
  return <div className="art-studio-shade" role="presentation" onClick={onClose}>
    <section className="art-studio" role="dialog" aria-modal="true" aria-label="Original battle background manager" onClick={(e:{stopPropagation:()=>void})=>e.stopPropagation()}>
      <header className="studio-header"><div><small>OFFICIAL GAME ASSETS</small><h2>BATTLE BACKGROUNDS</h2></div><button onClick={onClose} aria-label="Close background manager">✕ CLOSE</button></header>
      <div className="studio-grid">
        <div className="studio-inputs">
          <label htmlFor="background-boss">ENCOUNTER</label>
          <select id="background-boss" value={id} onChange={(e:{target:{value:string}})=>{setId(e.target.value as BackgroundId);setCrop(null);setPreview(null);setImageSize({w:0,h:0});}}>
            {backgroundIds.map(key=><option key={key} value={key}>{battleBackgrounds[key].scene} · {key.replace(/_/g,' ')}</option>)}
          </select>
          <p className="studio-meta"><b>{info.place}</b><br/>{info.style}</p>
          <p>{info.hint}</p>
          <label className="file-pick">SELECT IMAGE FILE<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e:{target:{files:FileList|null;value:string}})=>{void upload(e.target.files?.[0]);e.target.value='';}}/></label>
          <div className="studio-modes" role="group" aria-label="Import region"><button className={selection==='whole'?'active':''} onClick={()=>setSelection('whole')}>Whole image</button><button className={selection==='crop'?'active':''} onClick={()=>setSelection('crop')}>Crop from sheet</button></div>
          <div className="studio-actions"><button disabled={!preview||busy} onClick={()=>void save()}>SAVE IN BROWSER</button><button disabled={!preview||busy} onClick={()=>void exportForBuild()}>EXPORT PNG FOR BUILD</button><button disabled={busy} onClick={()=>void remove()}>REMOVE LOCAL</button></div>
          <p className="studio-message" role="status">{message}</p>
        </div>
        <div className="studio-preview">
          {preview?<div className="crop-viewport">
             <img id="source-image-preview" src={preview} onLoad={(e:{currentTarget:HTMLImageElement})=>setImageSize({w:e.currentTarget.naturalWidth,h:e.currentTarget.naturalHeight})} alt="Selected artwork for cropping" draggable={false}
              style={{cursor:selection==='crop'?'crosshair':'default'}} onPointerDown={begin} onPointerMove={move} onPointerUp={end} onPointerCancel={end}/>
             {selection==='crop'&&crop&&imageSize.w>0&&<div className="crop-overlay" style={{left:`${crop.x/imageSize.w*100}%`,top:`${crop.y/imageSize.h*100}%`,width:`${crop.w/imageSize.w*100}%`,height:`${crop.h/imageSize.h*100}%`}}/>}
           </div>:<div className="studio-empty">Choose a background image or an art sheet to crop from.<br/>For sprite sheets, use “Crop from sheet” and drag across the arena to extract.</div>}
          <p>Assets are stored in this browser using IndexedDB. For distributable offline builds, put approved PNGs in <code>web/public/battle-backgrounds/</code> using the encounter filenames.</p>
        </div>
      </div>
    </section>
  </div>;
}
