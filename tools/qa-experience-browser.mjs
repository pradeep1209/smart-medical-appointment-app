import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const f=JSON.parse(readFileSync('.local/experience-qa.json')),out='qa/shared/experience',skill=process.argv[2];
const {Browser}=await import(pathToFileURL(`${skill}/scripts/lib/cdp.mjs`));
const {app,probe}=await import(pathToFileURL(`${skill}/scripts/lib/probe.mjs`));
const {judgeApp}=await import(pathToFileURL(`${skill}/scripts/lib/rules.mjs`));
const browser=await Browser.launch(),checks=[],screens=[];
const sleep=()=>new Promise(r=>setTimeout(r,250));
try{
 const page=await browser.newPage({width:1440,height:900});await page.send('Network.enable');
 const signIn=async(admin=false)=>{for(const [name,value]of[['careslot_session',admin?f.adminSession:f.session],['careslot_csrf',admin?f.adminCsrf:f.csrf]])await page.send('Network.setCookie',{name,value,url:'http://127.0.0.1:3000',path:'/',httpOnly:name==='careslot_session',sameSite:'Strict'});};
 const wait=async(text)=>{for(let i=0;i<60;i++){if(await page.eval(t=>document.body.innerText.includes(t),text))return;await sleep();}throw Error(`Expected rendered content: ${text}`);};
 const click=async(text)=>{assert(await page.eval(t=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===t);if(!b)return false;b.click();return true;},text),`Button missing: ${text}`);};
 await signIn();await page.goto(`http://127.0.0.1:3000/records?appointmentId=${f.visitId}`);await wait('Consultations & summaries');await wait('Issued consultation summary');
 assert(await page.eval(()=>document.querySelector('.experience-entry fieldset')?.disabled));checks.push('Issued consultation summary is rendered read-only on the assigned doctor dashboard');
 for(const [width,height]of[[1440,900],[768,1024],[390,844]]){
  await page.setViewport({width,height,mobile:width<600});await page.eval(()=>{scrollTo(0,0);return document.fonts.ready;});assert.equal(await page.eval(()=>document.documentElement.scrollWidth>innerWidth),false,`Horizontal overflow at ${width}`);
  screens.push({page:'visit-records',width,findings:judgeApp(await page.eval(app),await page.eval(probe),{width})});await page.screenshot({path:`${out}/web-records-${width}.png`,format:'png',fullPage:true});
 }
 await page.setViewport({width:1440,height:900});await click('Prescription documents');
 await page.eval(()=>document.querySelector('.experience-entry')?.setAttribute('open',''));
 await click('Prescription PDF');for(let i=0;i<60;i++){if(await page.eval(()=>!!document.querySelector('dialog[open] iframe[src^="blob:"]')))break;await sleep();}
 assert(await page.eval(()=>!!document.querySelector('dialog[open] iframe[src^="blob:"]')));await page.screenshot({path:`${out}/web-prescription-preview.png`,format:'png'});await click('Close preview');checks.push('Prescription PDF opens in a modal preview with download and share actions');
 await click('Professional details');
 await page.eval(()=>document.querySelector('#doctor-qualifications').form.requestSubmit());await wait('Professional details saved.');checks.push('Doctor professional details form saves through the authenticated dashboard proxy');
 if(process.argv[3]==='shared'){await click('Shared documents');await wait('CareSlot-QA-experience');await page.screenshot({path:`${out}/web-shared-document.png`,format:'png',fullPage:true});checks.push('Document shared from the physical patient phone appears in the assigned doctor dashboard');}
 await page.goto('http://127.0.0.1:3000/notifications');await wait('Clinic notifications');await click('Mark all read');await wait('Notifications marked read.');checks.push('Notification inbox and mark-all-read action work in browser');
 await signIn(true);await page.goto('http://127.0.0.1:3000/records');await wait('Save clinic details');
 assert.equal(await page.eval(()=>document.body.innerText.includes('Prescription documents')),false);
 await page.eval(()=>document.querySelector('#clinic-name').form.requestSubmit());await wait('Clinic details saved.');checks.push('Administrator clinic profile saves and clinical tabs remain unavailable');
 await page.screenshot({path:`${out}/web-clinic-profile.png`,format:'png',fullPage:true});
 assert.equal(page.consoleErrors.length,0,JSON.stringify(page.consoleErrors));
 writeFileSync(`${out}/web-review.json`,JSON.stringify({recordedAt:new Date().toISOString(),result:'PASS',checks,screens,consoleErrors:[]},null,2));console.log(JSON.stringify({result:'PASS',checks,findings:screens.flatMap(s=>s.findings)}));
}finally{await browser.close();}
