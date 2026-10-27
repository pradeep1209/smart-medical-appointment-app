const fs=require('node:fs');
const {carePdf}=require('../apps/api/dist/care-pdf');
async function run(){
 const sections=Array.from({length:10},(_,i)=>({title:`${i+1}. Fictional stress-test medicine`,lines:[`Dose: ${'Fictional dose instruction. '.repeat(4)}`,`Frequency: ${'QA clinician directions only. '.repeat(5)}`,`Duration: seven fictional days`, `Instructions: ${'This is fictional pagination test text. '.repeat(13)}`]}));
 sections.push({title:'Long consultation instructions',lines:['Fictional test paragraph. '.repeat(165)+'END OF LONG CLINICAL TEXT']});
 fs.writeFileSync('qa/shared/experience/long-prescription.pdf',await carePdf({title:'Prescription pagination test',reference:'QA-PAGINATION-ONLY',clinic:{name:'Fictional QA Clinic'},sections,qrUrl:'http://192.168.0.3:3001/api/v1/verify/prescriptions/'+ 'a'.repeat(48)}));
 console.log('Long PDF fixture generated for pagination checks.');
}
run().catch(e=>{console.error(e.message);process.exitCode=1;});
