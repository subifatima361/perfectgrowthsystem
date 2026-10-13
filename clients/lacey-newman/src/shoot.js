const {chromium}=require('playwright');
const path=require('path');
(async()=>{
  const b=await chromium.launch();
  const p=await b.newPage({viewport:{width:1300,height:1200},deviceScaleFactor:1});
  await p.goto('file://'+path.resolve(__dirname,'render.tmp.html'));
  await p.evaluate(()=>document.fonts.ready); await p.waitForTimeout(1500);
  const cards=await p.$$('.adcard');
  for(const c of cards){
    const name=await c.$eval('.cap strong',e=>e.textContent);
    const [id,title]=name.split(' · ');
    const slug=(id+'-'+title).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
    const ad=await c.$('.ad');
    await ad.screenshot({path:path.resolve(__dirname,'../png/'+slug+'.png')});
  }
  await b.close();
})();
