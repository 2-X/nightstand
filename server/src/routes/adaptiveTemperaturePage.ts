/* eslint max-len: ["error", { "code": 145, "ignoreTemplateLiterals": true }] */
import express from 'express';
const router = express.Router();
router.get('/adaptive-temperature', (_req, res) => res.type('html').send(`<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Adaptive temperature · Sandman</title><style>
body{font:17px system-ui;background:#101820;color:#edf4f5;margin:0;padding:28px;max-width:760px;margin:auto}
section{background:#1b2a35;padding:24px;margin:20px 0;border-radius:16px}h1{font-size:28px}
label{display:block;margin:16px 0}input,select,button{font:inherit;padding:10px;border-radius:8px;max-width:100%;box-sizing:border-box}
button{background:#a7e5e0;color:#102128;border:0;cursor:pointer}p{line-height:1.5}.status{color:#a7e5e0}
</style><h1>Adaptive temperature</h1>
<p>Small adjustments based on your own repeated comfort preferences. A manual temperature change holds your side for the rest of the night.</p>
<p>Learning needs at least three nights with consistent adjustments in the same part of the night. Automatic steps are limited to 1°F every 30 minutes and stay within 2°F of your bedtime setting.</p>
<div id="sides"></div><p id="message" role="status"></p>
<p>Observe records preferences without changing temperature. Active can adjust only while the bed is on, presence is sustained, and sensor readings are fresh. Sleep detection is an estimate; this does not guarantee better sleep.</p>
<a href="/" style="color:#a7e5e0">Back to Nightstand</a><script>
const sides=['left','right'];
for(const [index,side] of sides.entries()){
 const section=document.createElement('section');
 section.innerHTML='<h2></h2><form><label>Mode <select name="mode"><option value="off">Off</option><option value="observe">Observe and learn</option><option value="active">Active</option></select></label><label>Lowest comfortable temperature (°F) <input name="minimumF" type="number" min="55" max="110" required></label><label>Highest comfortable temperature (°F) <input name="maximumF" type="number" min="55" max="110" required></label><button>Save</button></form><p class="status" aria-live="polite"></p><p class="pump" aria-live="polite"></p>';
 section.querySelector('h2').textContent=index===0?'Sarah':'Kris';
 section.id=side;document.querySelector('#sides').append(section);
 section.querySelector('form').onsubmit=async event=>{event.preventDefault();const form=event.target;
 try{const response=await fetch('/api/adaptive-temperature',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({side,mode:form.mode.value,minimumF:Number(form.minimumF.value),maximumF:Number(form.maximumF.value)})});if(!response.ok)throw Error('Could not save settings');document.querySelector('#message').textContent='Saved';await refresh(false);}catch(error){document.querySelector('#message').textContent=error.message;}};
}
async function refresh(fill){try{const response=await fetch('/api/adaptive-temperature',{cache:'no-store'});if(!response.ok)throw Error('Pod unavailable');const state=await response.json();
 for(const side of sides){const section=document.getElementById(side),form=section.querySelector('form');if(fill){for(const name of ['mode','minimumF','maximumF'])form.elements[name].value=state[side][name];}
 const sample=state.circulation,reading=sample?.readings?.[side],age=sample?(Date.now()-sample.at)/1000:Infinity;
 section.querySelector('.pump').textContent=!sample?'Pump readings unavailable':age<0||age>30?'Pump readings stale — automatic changes paused':
 reading?'Pump: '+(reading.rpm===null?'RPM unavailable':reading.rpm+' RPM')+' · '+(reading.water===null?'water sensor unavailable':reading.water?'water detected':'water not detected')+' · updated '+Math.max(0,Math.floor(age))+'s ago':
 sample[side]?'Circulation confirmed':'Pump stopped or circulation unconfirmed';
 const decision=state[side].decision;section.querySelector('.status').textContent=state.fault||
 (decision.kind==='propose'?(state[side].mode==='observe'?'Would adjust to ':'Proposed target: ')+decision.targetF+'°F':decision.reason.replaceAll('-',' '));}
 }catch(error){document.querySelector('#message').textContent=error.message;}}
fetch('/api/settings').then(r=>r.json()).then(s=>{for(const side of sides){if(s[side]?.name)document.getElementById(side).querySelector('h2').textContent=s[side].name;}}).catch(()=>{});
refresh(true);setInterval(()=>refresh(false),10000);
</script></html>`));
export default router;
