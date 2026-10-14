// Compositing layers (count, megapixels, estimated GPU memory) and Home element statistics. Read-only.
import { connect } from "./lib.mjs";
const c = await connect();
let layers = null;
c.onEvent((m) => {
  if (m.method === "LayerTree.layerTreeDidChange" && m.params.layers) layers = m.params.layers;
});
await c.send("LayerTree.enable");
await new Promise((r) => setTimeout(r, 2500));
if (layers) {
  const px = layers.reduce((a, l) => a + (l.drawsContent ? l.width * l.height : 0), 0);
  const big = layers
    .filter((l) => l.drawsContent)
    .sort((a, b) => b.width * b.height - a.width * a.height)
    .slice(0, 6)
    .map((l) => `${l.width}x${l.height}`);
  console.log(
    JSON.stringify({
      layers: layers.length,
      drawing: layers.filter((l) => l.drawsContent).length,
      megapixels: Math.round(px / 1e6),
      approxMB: Math.round((px * 4) / 1048576),
      biggest: big
    })
  );
} else console.log("NO_LAYER_DATA");
await c.send("LayerTree.disable");
console.log(
  await c.ev(
    `(()=>{const all=[...document.querySelectorAll("#home *")];let wc=0,tr=0,an=0,fl=0,bf=0;for(const e of all){const s=getComputedStyle(e);if(s.willChange!=="auto")wc++;if(s.transform!=="none")tr++;if(s.animationName!=="none")an++;if(s.filter!=="none")fl++;if(s.backdropFilter&&s.backdropFilter!=="none")bf++}const rows=[...document.querySelectorAll("#home .home-row")];const vis=rows.filter(r=>{const b=r.getBoundingClientRect();return b.bottom>0&&b.top<innerHeight}).length;const cards=document.querySelectorAll("#home .home-content-card").length;const imgs=[...document.querySelectorAll("#home img")];const loaded=imgs.filter(i=>i.complete&&i.naturalWidth>0);const over=loaded.filter(i=>i.naturalWidth>i.clientWidth*1.5&&i.clientWidth>0).length;const decodedMB=Math.round(loaded.reduce((a,i)=>a+i.naturalWidth*i.naturalHeight*4,0)/1048576);return JSON.stringify({elements:all.length,rows:rows.length,rowsOnScreen:vis,cards,imgs:imgs.length,imgsLoaded:loaded.length,imgsOversized:over,decodedIfAllMB:decodedMB,willChange:wc,transform:tr,animated:an,filter:fl,backdropFilter:bf,viewport:innerWidth+"x"+innerHeight,dpr:devicePixelRatio})})()`
  )
);
c.close();
process.exit(0);
