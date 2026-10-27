// No PDF generation: exercises the doctor correction/revocation forms on owned QA records.
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const f=JSON.parse(readFileSync('.local/experience-qa.json')),skill=process.argv[2];
assert.equal(f.kind,'experience-release');
const {Browser}=await import(pathToFileURL(`${skill}/scripts/lib/cdp.mjs`));
const browser=await Browser.launch(),checks=[];
try{
 const page=await browser.newPage({width:1440,height:900});await page.send('Network.enable');
 for(const [name,value]of[['careslot_session',f.session],['careslot_csrf',f.csrf]])await page.send('Network.setCookie',{name,value,url:'http://127.0.0.1:3000',path:'/',httpOnly:name==='careslot_session',sameSite:'Strict'});
 const wait=async(text)=>{for(let i=0;i<60;i++){if(await page.eval(t=>document.body.innerText.includes(t),text))return;await new Promise(r=>setTimeout(r,250));}throw Error(`Missing ${text}`);};
 const click=async(text)=>assert(await page.eval(t=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===t);if(!b)return false;b.click();return true;},text),text);
 await page.goto('http://127.0.0.1:3000/records');await wait('Prescription documents');await click('Prescription documents');
 await page.eval(()=>{document.querySelector('.experience-entry').open=true;});await click('Correct or revoke this prescription');
 await page.eval(id=>{const field=document.querySelector(`#reason-${id}`);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,'Fictional QA correction');field.dispatchEvent(new Event('input',{bubbles:true}));window.confirm=()=>true;},f.rxId);
 await click('Review and issue replacement');await wait('Replacement prescription issued; previous copy retained.');checks.push('Doctor correction form issues a replacement and retains the previous document');
 await page.eval(()=>{for(const d of document.querySelectorAll('details.experience-entry'))d.open=true;});await click('Correct or revoke this prescription');
 await page.eval(()=>{const field=document.querySelector('input[id^="reason-"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,'Fictional QA revocation');field.dispatchEvent(new Event('input',{bubbles:true}));});
 await click('Revoke without replacement');await wait('Prescription revoked; its record is retained.');checks.push('Doctor revocation form saves a revoked status without deleting history');
 await page.screenshot({path:'qa/shared/experience/web-correction-history.png',format:'png',fullPage:true});assert.equal(page.consoleErrors.length,0);
 writeFileSync('qa/shared/experience/web-correction-checks.json',JSON.stringify({recordedAt:new Date().toISOString(),result:'PASS',checks},null,2));console.log(JSON.stringify({result:'PASS',checks}));
}finally{await browser.close();}
