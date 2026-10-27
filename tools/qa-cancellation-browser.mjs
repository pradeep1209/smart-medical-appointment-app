import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const f=JSON.parse(readFileSync('.local/cancellation-qa.json'));
const skill=process.argv[2],output='qa/shared/cancellation';
const { Browser }=await import(pathToFileURL(`${skill}/scripts/lib/cdp.mjs`));
const { app,probe }=await import(pathToFileURL(`${skill}/scripts/lib/probe.mjs`));
const { judgeApp }=await import(pathToFileURL(`${skill}/scripts/lib/rules.mjs`));
const browser=await Browser.launch();
try {
 const page=await browser.newPage({width:1440,height:900});await page.send('Network.enable');
 for(const [name,value] of [['careslot_session',f.session],['careslot_csrf',f.csrf]]) await page.send('Network.setCookie',{name,value,url:'http://127.0.0.1:3000',path:'/',httpOnly:name==='careslot_session',sameSite:'Strict'});
 await page.goto(`http://127.0.0.1:3000/appointments?date=${f.date}`);
 for(let i=0;i<40;i++){if(await page.eval(()=>document.body.innerText.includes('Cancelled by patient')))break;await new Promise(r=>setTimeout(r,250));}
 const text=await page.eval(()=>document.body.innerText);
 for(const label of ['Cancelled by patient','Cancelled by doctor · QA Cancellation Doctor','Cancelled by clinic administrator','Cancelled by reception']) assert(text.includes(label),label);
 await page.eval(()=>{for(const history of document.querySelectorAll('.visit-history'))history.open=true;});
 const screens=[];
 for(const [width,height] of [[1440,900],[768,1024],[390,844]]){
  await page.setViewport({width,height,mobile:width<600});await page.eval(()=>{scrollTo(0,0);return document.fonts.ready;});
  assert.equal(await page.eval(()=>document.documentElement.scrollWidth>innerWidth),false);
  const findings=judgeApp(await page.eval(app),await page.eval(probe),{width});screens.push({width,findings});
  await page.screenshot({path:`${output}/web-${width}.png`,format:'png',fullPage:true});
 }
 assert.equal(page.consoleErrors.length,0);
 writeFileSync(`${output}/web-review.json`,JSON.stringify({recordedAt:new Date().toISOString(),result:'PASS',checks:['Four cancellation actors shown on clinic visit cards and expanded history','Three responsive widths; no horizontal overflow'],screens,consoleErrors:[]},null,2));
 console.log(JSON.stringify({result:'PASS',findings:screens.flatMap(s=>s.findings)}));
}finally{await browser.close();}
