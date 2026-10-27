import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

export type PaperSection={title:string;lines:string[]};
export async function carePdf(input:{title:string;reference:string;clinic?:{name:string;address?:string;phone?:string;contactEmail?:string;logoData?:string|null};subtitle?:string;sections:PaperSection[];qrUrl?:string;status?:string}) {
 const font=resolve(__dirname,'../../../apps/web/public/fonts/dm-sans.ttf');
 const doc=new PDFDocument({size:'A4',margins:{top:46,right:46,bottom:80,left:46},bufferPages:true,info:{Title:input.title,Author:input.clinic?.name||'CareSlot',Subject:input.reference}});
 const chunks:Buffer[]=[];const done=new Promise<Buffer>((resolve,reject)=>{doc.on('data',(b:Buffer)=>chunks.push(b));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);});
 if(existsSync(font)) doc.font(font);
 const ink='#183e35',muted='#566a62',width=503;
 doc.rect(0,0,595,12).fill(ink);
 let y=42;
 if(input.clinic?.logoData){try{doc.image(Buffer.from(input.clinic.logoData.split(',')[1]!,'base64'),46,y,{fit:[58,50]});y+=58;}catch{/* A malformed legacy logo must not hide clinical text. */}}
 doc.fillColor(ink).fontSize(20).text(input.clinic?.name||'CareSlot',46,y,{width});
 doc.fontSize(9).fillColor(muted).text([input.clinic?.address,input.clinic?.phone,input.clinic?.contactEmail].filter(Boolean).join(' · '),{width});
 doc.moveDown(1).fillColor(ink).fontSize(24).text(input.title,{width});
 doc.fontSize(10).fillColor(muted).text(input.reference,{width});
 if(input.status)doc.text(`Document status at download: ${input.status}`,{width});
 if(input.subtitle)doc.moveDown(.5).text(input.subtitle,{width});
 doc.moveDown(1);
 function room(h:number){if(doc.y+h>doc.page.height-80){doc.addPage();doc.y=46;}}
 for(const section of input.sections){room(60);doc.fillColor(ink).fontSize(13).text(section.title,{width});doc.moveDown(.35);
  for(const line of section.lines){const clean=String(line||'—');doc.fontSize(10);const h=doc.heightOfString(clean,{width,lineGap:3});room(Math.min(h,80)+6);doc.fillColor('#243b33').text(clean,{width,lineGap:3});doc.moveDown(.35);}
  doc.moveDown(.65);
 }
 if(input.qrUrl){room(125);const top=doc.y;const qr=await QRCode.toBuffer(input.qrUrl,{width:280,margin:2,errorCorrectionLevel:'M'});doc.image(qr,46,top,{width:94,height:94});doc.fontSize(9).fillColor(muted).text('Scan to verify issuer, reference and current status. No patient or medication details are shown on the verification page.',154,top+8,{width:385});doc.text('Local development: verification requires access to the clinic Wi-Fi.',154,doc.y+8,{width:385});doc.y=top+110;}
 const range=doc.bufferedPageRange();
 for(let i=0;i<range.count;i++){doc.switchToPage(i);const bottom=doc.page.margins.bottom;doc.page.margins.bottom=0;doc.fontSize(8).fillColor(muted).text(`CareSlot · ${input.reference} · Page ${i+1} of ${range.count}`,46,doc.page.height-47,{width,align:'center',lineBreak:false});doc.page.margins.bottom=bottom;}
 doc.end();return done;
}
