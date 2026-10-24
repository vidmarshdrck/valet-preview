'use strict';
/* theme: persisted, applied before paint */
const root=document.documentElement;const setTheme=t=>{root.dataset.theme=t;localStorage.theme=t;const b=document.querySelector('#themeBtn');if(b){const light=t=='light';b.setAttribute('aria-label',light?'Switch to dark mode':'Switch to light mode');b.textContent=light?'Dark theme':'Light theme'}};setTheme(localStorage.theme||'dark');
const $=s=>document.querySelector(s),esc=t=>String(t??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const kb=n=>n<1024?n+' B':n<1048576?(n/1024).toFixed(1)+' KB':(n/1048576).toFixed(1)+' MB';
// Deployment base: served by the companion backend under /valet/, so the API lives one level up (keeps any /bags-mark/ proxy prefix).
const BASE=new URL(location.pathname.includes('/valet/')?'../':'./',location.href);
const U=p=>new URL(p,BASE).toString();
if('serviceWorker'in navigator)navigator.serviceWorker.register('sw.js');

/* ================= backend adapter: companion protocol v1, mock fallback ================= */
const B={mode:'detecting',token:null,expires:0,provider:null,ws:null,wsReady:false,pending:null};
const voiceSession=window.createVoiceSession();
function rememberToken(t,exp){B.token=t||null;B.expires=exp||0;if(t)localStorage.valetToken=t;else localStorage.removeItem('valetToken')}
function currentPersonality(){return ['cynical','precise','warm'].includes(localStorage.valetPersonality)?localStorage.valetPersonality:'cynical'}
async function http(path,o={}){const h={...(o.headers||{})};if(B.token)h.Authorization='Bearer '+B.token;
 let body=o.body;if(body&&!(body instanceof Blob)&&typeof body!='string'){body=JSON.stringify(body);h['Content-Type']='application/json'}
 const r=await fetch(U(path),{method:o.method||'GET',headers:h,body});const d=await r.json().catch(()=>({}));
 if(r.status==401&&B.token){rememberToken(null);closeWS();setConn();sys('Session expired. Sign in again from the connection panel.')}return{ok:r.ok,status:r.status,data:d}}
const api=(p,o={})=>B.mode=='server'?http('api/'+p,o):mockApi(p,o);
async function detect(){try{const r=await fetch(U('health'),{cache:'no-store'});const d=await r.json();if(d&&d.protocol==1){B.mode='server';B.provider=d.provider;const saved=localStorage.valetToken;if(saved){B.token=saved;const s=await http('api/session');if(s.ok){B.expires=s.data.expires_at;B.provider=s.data.provider;if(s.data.personality)applyPersonality(s.data.personality);hideConn();setConn();await loadRoster();await loadHistory();openWS();return}rememberToken(null)}setConn();return}}catch{}B.mode='mock';restoreLocal();setConn()}
function hideConn(){const p=$('#connPanel');if(p)p.hidden=true;$('#connBtn').setAttribute('aria-expanded','false')}
function setConn(){const c=$('#conn'),n=$('#connNote');const signedOut=B.mode=='server'&&!B.token;$('#loginForm').hidden=!signedOut;$('#pairForm').hidden=!signedOut;$('#lockBtn').hidden=!(B.mode=='server'&&B.token);
 if(B.mode=='mock'){c.textContent='On this device';n.textContent='No Bags server was found here. This conversation stays in the browser.'}
 else if(B.mode!='server'){c.textContent='Checking';n.textContent='Looking for a Bags server on this origin.'}
 else if(!B.token){c.textContent='Sign in';n.textContent='Bags server found. Sign in with the owner password, or pair with a one-time code (it expires in 5 minutes).';if(!B.panelShown){B.panelShown=true;$('#connPanel').hidden=false;$('#connBtn').setAttribute('aria-expanded','true')}}
 else{const st=B.provider?.state||'unknown';const named=B.provider?.model?`${B.provider.name} (${B.provider.model})`:(B.provider?.name||'none');c.textContent=B.wsReady?'Connected':'Signed in';n.textContent=`Signed in. Text provider: ${named} (${st}). Session expires ${new Date(B.expires*1000).toLocaleTimeString()}. Personality changes tone only.`}
 $('#provider').textContent=(voiceSession.active?'Live':B.mode=='mock'?'Text on this device':'Text')+' · '+currentPersonality()}
$('#connBtn').onclick=()=>{const p=$('#connPanel');p.hidden=!p.hidden;$('#connBtn').setAttribute('aria-expanded',!p.hidden)};
$('#pairForm').onsubmit=async e=>{e.preventDefault();const code=$('#pairCode').value.trim();if(!code)return;
 const r=await fetch(U('api/pair'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code})});const d=await r.json().catch(()=>({}));$('#pairCode').value='';
 if(!r.ok)return sys('Pairing failed: '+(d.error||r.status)+'. Ask your server for a fresh code.');
 rememberToken(d.token,d.expires_at);hideConn();setConn();sys('Device paired. This session is separate from Telegram.');await loadRoster();await loadHistory();greetIfEmpty();openWS()};
$('#loginForm').onsubmit=async e=>{e.preventDefault();const password=$('#ownerPassword').value;$('#ownerPassword').value='';if(!password)return;
 const r=await fetch(U('api/login'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password,personality:currentPersonality()})});const d=await r.json().catch(()=>({}));
 if(!r.ok)return sys(r.status==429?'Too many sign-in attempts. Wait and try again.':'Sign-in failed: '+(d.error||r.status)+'.');
 rememberToken(d.token,d.expires_at);if(d.personality)applyPersonality(d.personality);hideConn();setConn();sys('Signed in.');await loadRoster();await loadHistory();greetIfEmpty();openWS()};
$('#personality').onchange=async()=>{applyPersonality($('#personality').value);if(B.mode=='server'&&B.token){const r=await http('api/settings',{method:'POST',body:{personality:currentPersonality()}});if(!r.ok)sys('Could not save personality: '+(r.data.error||r.status));else sys('Personality is now '+r.data.personality+'. Permissions are unchanged.')}};
$('#lockBtn').onclick=async()=>{if(!confirm('Erase all companion sessions, files, tasks and meetings for this device on the server?'))return;
 const r=await http('api/device',{method:'DELETE'}).catch(()=>({ok:false}));rememberToken(null);localStorage.removeItem('valetLogs');localStorage.removeItem('valetThreads');localStorage.removeItem('valetConversation');conversationId='';closeWS();logs={};render();setConn();sys(r.ok?'Device locked and erased on the server.':'Cleared locally. Server erase could not be confirmed.')};
function openWS(){if(B.mode!='server'||!B.token)return;closeWS();const w=new WebSocket(U('api/live').replace(/^http/,'ws'));B.ws=w;
 w.onopen=()=>w.send(JSON.stringify({type:'auth',token:B.token}));
 w.onmessage=ev=>{if(typeof ev.data!='string')return;const m=JSON.parse(ev.data);
  if(m.type=='ready'){B.wsReady=true;B.provider=m.provider;setConn();if(!m.provider?.capabilities?.text)sys('Connected, but no text provider is enabled on the server, so Bags cannot reply yet.')}
  else if(m.type=='text'||m.type=='transcript.output'){botText(m.text,P.name+' · '+(B.provider?.name||'server'))}
  else if(m.type=='turn.complete'){if(m.conversation_id)rememberConversation(m.conversation_id);paintOrb();flushBot()}
  else if(m.type=='error'){flushBot();window.noteReplyFailed(voiceSession);paintOrb();sys(ERR[m.error]||('Server error: '+m.error));if(voiceSession.active&&!voiceSession.muted)listen()}};
 w.onclose=e=>{B.ws=null;B.wsReady=false;window.noteReplyFailed(voiceSession);paintOrb();setConn();if(e.code==4401){rememberToken(null);setConn();sys('Session expired. Sign in again.')}};
 clearInterval(B.ping);B.ping=setInterval(()=>B.ws?.readyState==1&&B.ws.send('{"type":"ping"}'),20000)}
function closeWS(){try{B.ws&&B.ws.close()}catch{}B.ws=null;B.wsReady=false}
const ERR={provider_unavailable:'The text provider failed on the server. No reply was invented in its place.',provider_busy:'Bags is busy with another reply. Try again in a moment.',turn_busy:'Still answering your last message.',interrupted:'Reply stopped.',codex_text_failed_or_sandbox_blocked:'The text provider failed on the server. Nothing was sent elsewhere.',speech_layer_required:'Server voice is not available. Live session uses your browser speech instead.',attachment_not_supported:'The current provider cannot read attachments. The file is stored, not analysed.',auth_not_configured:'This server has no owner password yet. Set VALET_OWNER_PASSWORD and restart it.'};
let botBuf='',botTimer;function botText(t,src){botBuf+=t;clearTimeout(botTimer);botTimer=setTimeout(()=>flushBot(src),1500);B.src=src}
function flushBot(){clearTimeout(botTimer);if(!botBuf)return;const t=botBuf;botBuf='';add('bot',t,B.src||'Bags');if(voiceSession.active)say(t)}

/* ================= roster ================= */
const sp=([id,name,role])=>({id,name,role,live:false});
let roster=null;
async function loadRoster(){if(B.mode=='server'&&B.token){const r=await http('api/agents');if(r.ok){roster=r.data.agents.map(a=>({id:a.id,name:a.id=='bagheera_butler.agent'?P.name:a.name,role:a.role||a.route,live:!!a.live&&a.id=='bagheera_butler.agent'}));tree();return}}roster=null;tree()}
const allAgents=()=>roster||[ORG.personal];
function tree(){const row=a=>`<button class="agent" data-id="${esc(a.id)}"><b>${esc(a.name)}</b><span class="r">${esc(a.role)}</span><span class="st ${a.live?'live':''}">${a.live?'Available':'Away'}</span></button>`;
 const people=allAgents();
 $('#tree').innerHTML=`<div class="glass unit">${people.map(row).join('')}</div>`;
 $('#tree').querySelectorAll('[data-id]').forEach(el=>el.onclick=()=>pick(people.find(a=>a.id==el.dataset.id)));
 const parts=$('#mParts');if(parts)parts.innerHTML=people.map(a=>`<label><input type="checkbox" value="${esc(a.id)}" ${a.id==people[0].id?'checked disabled':''}> ${esc(a.name)} <span class="note">${esc(a.role)}</span></label>`).join('')}
const P={name:ORG.personal.name,short:ORG.personal.short||ORG.personal.name};let agent={...ORG.personal},logs={};
async function pick(a){stopLive();if(B.mode=='server'&&B.token){const r=await http(`api/agents/${encodeURIComponent(a.id)}/session`,{method:'POST',body:{}});if(r.ok){B.token=r.data.token;openWS()}}
 agent=a;$('#agentHdr').textContent=a.name+' · '+a.role+(a.live?'':' (disconnected)');$('#msg').disabled=!a.live;$('#msg').placeholder=a.live?'Message '+a.name:a.name+' is disconnected';render();go('chat')}

/* ================= bottom tab bar ================= */
function go(tab){document.querySelectorAll('.tabbar button').forEach(b=>{const on=b.dataset.tab==tab;b.classList.toggle('on',on);on?b.setAttribute('aria-current','page'):b.removeAttribute('aria-current')});
 document.querySelectorAll('.tab').forEach(s=>s.classList.toggle('on',s.id==tab));document.body.classList.toggle('no-dock',tab!='chat');
 if(tab=='act'){loadTasks();loadMeetings()}if(tab=='calls')renderCalls();if(tab=='chat')scrollEnd();else scrollTo(0,0)}
document.querySelectorAll('.tabbar button').forEach(b=>b.onclick=()=>go(b.dataset.tab));

/* ================= chat log ================= */
const scrollEnd=()=>requestAnimationFrame(()=>{const log=$('#log');if(log)log.scrollTop=log.scrollHeight});
function add(who,text,src,extra={}){(logs[agent.id]??=[]).push({who,text,src,...extra});render();persistLocal()}
let conversationId=localStorage.valetConversation||'';
function rememberConversation(id){conversationId=id||'';if(conversationId)localStorage.valetConversation=conversationId;else localStorage.removeItem('valetConversation')}
function readThreads(){try{return JSON.parse(localStorage.valetThreads||'[]')}catch{return []}}
function writeThreads(list){localStorage.valetThreads=JSON.stringify(list.slice(0,40))}
function persistLocal(){if(B.mode=='server')return;try{const slim={};for(const[k,arr]of Object.entries(logs))slim[k]=arr.filter(m=>!m.audio).slice(-200);localStorage.valetLogs=JSON.stringify(slim);const messages=slim[agent.id]||[];if(!conversationId)rememberConversation('local-current');const preview=(messages.find(m=>m.who=='me')||{}).text||'';const rest=readThreads().filter(t=>t.id!==conversationId);rest.unshift({id:conversationId,title:(preview||'This chat').slice(0,80),updated:Date.now(),preview,messages});writeThreads(rest)}catch{}}
function restoreLocal(){try{const threads=readThreads();if(threads.length){const current=threads.find(t=>t.id===localStorage.valetConversation)||threads[0];rememberConversation(current.id);logs[agent.id]=current.messages||[];render();return}const slim=JSON.parse(localStorage.valetLogs||'{}');if(slim.bags&&!slim['bagheera_butler.agent'])slim['bagheera_butler.agent']=slim.bags;logs=slim}catch{logs={}}render()}
async function loadHistory(){const query=conversationId?'&conversation='+encodeURIComponent(conversationId):'';const r=await http('api/messages?agent='+encodeURIComponent(agent.id)+query);if(!r.ok){if(r.status==404){rememberConversation('');return loadHistory()}return}if(r.data.conversation_id)rememberConversation(r.data.conversation_id);logs[agent.id]=(r.data.messages||[]).map(m=>({who:m.role=='user'?'me':'bot',text:m.text,src:m.role=='user'?'You':P.name+' · '+(m.personality||'Bags')}));render()}
function paintHistory(items){const list=$('#historyList');list.innerHTML=items.length?items.map(item=>`<button type="button" data-c="${esc(item.id)}"><b>${esc(item.title||'Chat')}</b><span class="note">${esc((item.preview||'').slice(0,80))}</span></button>`).join(''):'<p class="note">No earlier chats yet.</p>';list.querySelectorAll('[data-c]').forEach(button=>button.onclick=()=>openConversation(button.dataset.c))}
async function showHistory(){if(B.mode=='server'&&B.token){const r=await http('api/conversations');if(!r.ok)return sys('History is not available until you are signed in.');paintHistory(r.data.conversations||[])}else paintHistory(readThreads());$('#historySheet').hidden=false}
async function openConversation(id){rememberConversation(id);$('#historySheet').hidden=true;if(B.mode=='server'&&B.token){await loadHistory();return}const thread=readThreads().find(item=>item.id===id);logs[agent.id]=thread?.messages||[];render()}
async function startNewChat(){$('#historySheet').hidden=true;if(B.mode=='server'&&B.token){const r=await http('api/conversations',{method:'POST',body:{}});if(!r.ok)return sys('Could not start a new chat.');rememberConversation(r.data.id);logs[agent.id]=[];render();greetIfEmpty();return}rememberConversation('local-'+Date.now());logs[agent.id]=[];render();greetIfEmpty();persistLocal()}
$('#historyBtn').onclick=()=>showHistory();
$('#historyClose').onclick=()=>{$('#historySheet').hidden=true};
$('#newChat').onclick=()=>startNewChat();
function greetIfEmpty(){if((logs[agent.id]||[]).length)return;add('bot',`Good evening, sir. ${P.name} here. Type a message, attach a file or an email, or hold the mic for a voice note. Tap Live when you want to talk hands-free.`,P.name)}
const sys=t=>add('sys',t,'System');
function attHTML(a){if(a.kind=='email')return`<div class="mailcard"><b>${esc(a.subject||'(no subject)')}</b><div class="m">From ${esc(a.from||'unknown')}${a.date?' · '+esc(a.date):''}</div><div>${esc(a.body.slice(0,160))}${a.body.length>160?'…':''}</div></div>`;
 return a.thumb?`<div class="att"><img src="${a.thumb}" alt="${esc(a.name)}"></div>`:`<div class="att"><svg><use href="#i-file"/></svg>${esc(a.name)} · ${kb(a.size)}${a.status?' · '+esc(a.status):''}</div>`}
function render(){$('#log').innerHTML=(logs[agent.id]||[]).map(m=>`<div class="b ${m.who}"><span class="src">${esc(m.src)}</span>${m.audio?`<audio controls preload="metadata" src="${m.audio}"></audio><div class="tr">${m.text?'Transcript: '+esc(m.text):esc(m.note||'No transcript')}</div>`:esc(m.text)}${(m.atts||[]).map(attHTML).join('')}</div>`).join('');scrollEnd()}

/* ================= attachments: files + emails ================= */
let atts=[];const SERVER_MIME=['image/jpeg','image/png','text/plain','application/pdf'],MAX=2*1048576;
function chips(){$('#chips').innerHTML=atts.map((a,i)=>`<div class="chip-f">${a.thumb?`<img src="${a.thumb}" alt="">`:`<svg><use href="#i-${a.kind=='email'?'mail':'file'}"/></svg>`}<span>${esc(a.kind=='email'?(a.subject||'Email'):a.name)}</span><small>${a.kind=='email'?'email':kb(a.size)}</small><button type="button" aria-label="Remove ${esc(a.name||a.subject)}" data-i="${i}"><svg><use href="#i-x"/></svg></button></div>`).join('');
 $('#chips').querySelectorAll('button').forEach(b=>b.onclick=()=>{atts.splice(+b.dataset.i,1);chips()})}
const menu=v=>{$('#attachMenu').hidden=!v;$('#attach').setAttribute('aria-expanded',v)};
$('#attach').onclick=()=>menu($('#attachMenu').hidden);
$('#pickFile').onclick=()=>{menu(false);$('#fileInput').click()};
$('#fileInput').onchange=e=>{for(const f of e.target.files){if(atts.length>=16){sys('Up to 16 attachments per message.');break}
 if(/\.eml$/i.test(f.name)||f.type=='message/rfc822'){f.text().then(t=>{atts.push(parseEmail(t,f.name));chips()});continue}
 atts.push({kind:'file',file:f,name:f.name,size:f.size,mime:f.type||'application/octet-stream',thumb:f.type.startsWith('image/')?URL.createObjectURL(f):null})}e.target.value='';chips()};
$('#pickEmail').onclick=()=>{menu(false);$('#emailSheet').hidden=false;$('#emlText').focus()};
$('#emlCancel').onclick=()=>{$('#emailSheet').hidden=true;$('#emlText').value=''};
$('#emlUpload').onclick=()=>$('#emlInput').click();
$('#emlInput').onchange=async e=>{const f=e.target.files[0];if(f){$('#emlText').value=await f.text()}e.target.value=''};
$('#emlAdd').onclick=()=>{const t=$('#emlText').value.trim();if(!t)return;atts.push(parseEmail(t,'pasted email'));chips();$('#emailSheet').hidden=true;$('#emlText').value=''};
function decodeQP(s){return s.replace(/=\r?\n/g,'').replace(/=([0-9A-F]{2})/gi,(_,h)=>String.fromCharCode(parseInt(h,16)))}
function decodeWord(s){return s.replace(/=\?([^?]+)\?([BQ])\?([^?]*)\?=/gi,(_,cs,enc,t)=>{try{const bytes=enc.toUpperCase()=='B'?Uint8Array.from(atob(t),c=>c.charCodeAt(0)):Uint8Array.from(decodeQP(t.replace(/_/g,' ')),c=>c.charCodeAt(0));return new TextDecoder(cs).decode(bytes)}catch{return t}})}
function parseEmail(raw,name){raw=raw.replace(/\r\n/g,'\n');const i=raw.indexOf('\n\n'),head=i<0?raw:raw.slice(0,i),body0=i<0?'':raw.slice(i+2);
 const H={};head.replace(/\n[ \t]+/g,' ').split('\n').forEach(l=>{const k=l.indexOf(':');if(k>0)H[l.slice(0,k).trim().toLowerCase()]=decodeWord(l.slice(k+1).trim())});
 let body=body0;const bm=/boundary="?([^";\n]+)"?/i.exec(H['content-type']||'');
 if(bm){const parts=body0.split('--'+bm[1]);const tp=parts.find(p=>/content-type:\s*text\/plain/i.test(p))||parts.find(p=>/content-type:\s*text\/html/i.test(p))||'';const j=tp.replace(/\r\n/g,'\n').indexOf('\n\n');body=j<0?tp:tp.slice(j+2);
  if(/quoted-printable/i.test(tp.slice(0,j)))body=decodeQP(body);else if(/base64/i.test(tp.slice(0,j)))try{body=new TextDecoder().decode(Uint8Array.from(atob(body.replace(/\s/g,'')),c=>c.charCodeAt(0)))}catch{}
  if(/text\/html/i.test(tp.slice(0,j)))body=body.replace(/<[^>]+>/g,' ')}
 else if(/quoted-printable/i.test(H['content-transfer-encoding']||''))body=decodeQP(body);
 body=body.replace(/\n{3,}/g,'\n\n').trim();
 if(!H.from&&!H.subject)return{kind:'email',name,from:'',subject:'Pasted text',date:'',to:'',body:raw.trim(),raw};
 return{kind:'email',name,from:H.from||'',to:H.to||'',subject:H.subject||'',date:H.date||'',body,raw}}
async function uploadAll(list){// companion: raw bytes, exact MIME, explicit consent header. Others stay on device.
 for(const a of list){if(B.mode!='server'){a.status='kept on device';continue}
  let blob,mime;if(a.kind=='email'){mime='text/plain';blob=new Blob([`From: ${a.from}\nTo: ${a.to}\nSubject: ${a.subject}\nDate: ${a.date}\n\n${a.body}`.slice(0,MAX)],{type:mime})}else{blob=a.file;mime=a.mime}
  if(!SERVER_MIME.includes(mime)){a.status='kept on device (server accepts JPEG, PNG, text, PDF)';continue}
  if(blob.size>MAX){a.status='kept on device (over 2 MB)';continue}
  const r=await http('api/uploads',{method:'POST',body:blob,headers:{'Content-Type':mime,'X-Upload-Consent':'yes'}});a.status=r.ok?'stored on server, not analysed':'upload failed: '+(r.data.error||r.status)}}

/* ================= send ================= */
async function send(text,meta={}){text=(text||'').trim();const list=atts;if(!text&&!list.length&&!meta.voice)return;
 if(!agent.live){add('me',text,'You',{atts:list.map(strip)});atts=[];chips();return sys(`${agent.name} is disconnected. No reply is generated on their behalf.`)}
 if(B.mode=='server'&&list.length){const desc=list.map(a=>a.kind=='email'?`email "${a.subject}"`:`${a.name} (${a.mime}, ${kb(a.size)})`).join(', ');if(!confirm(`Send to ${agent.name} on your server?\n${desc}`))return}
 atts=[];chips();await uploadAll(list);
 const emails=list.filter(a=>a.kind=='email');let full=text;// email text is shared as message context so Bags can read it
 for(const e of emails)full+=`\n\n[Attached email]\nFrom: ${e.from}\nSubject: ${e.subject}\nDate: ${e.date}\n${e.body}`;
 const files=list.filter(a=>a.kind=='file');if(files.length)full+=`\n\n[Attached files: ${files.map(f=>f.name+' '+kb(f.size)).join(', ')}]`;
 if(!meta.voice)add('me',text,voiceSession.active?'You · typed':'You',{atts:list.map(strip)});
 full=full.trim().slice(0,4096)||'[voice note with no transcript]';
 if(voiceSession.active)window.acceptTypedMessage(voiceSession, meta.voice?'':text);
 paintOrb();
 let pending=false;
 try{if(B.mode=='server'){if(!B.token){window.noteReplyFailed(voiceSession);return sys('Sign in first: tap the status button at the top.')}if(!B.wsReady){window.noteReplyFailed(voiceSession);return sys('Not connected to the server yet. Try again in a moment.')}B.ws.send(JSON.stringify({type:'text',text:full,conversation_id:conversationId||''}));pending=true;return}
  const r=await mockApi('chat',{method:'POST',body:{text:full,...meta,personality:currentPersonality(),files:files.length,emails:emails.map(e=>({subject:e.subject,from:e.from,body:e.body}))}});
  add('bot',r.data.reply,P.name);if(voiceSession.active||meta.voice)say(r.data.reply)}
 finally{if(!pending && !(voiceSession.active && voiceSession.processing))paintOrb()}}
const strip=a=>({kind:a.kind,name:a.name,size:a.size,thumb:a.thumb,status:a.status,subject:a.subject,from:a.from,date:a.date,body:a.body||''});
$('#composer').onsubmit=e=>{e.preventDefault();const typed=$('#msg').value;window.rememberComposerText(voiceSession, typed);$('#msg').value='';send(typed);if(agent.live)$('#msg').disabled=false;$('#msg').focus();paintOrb()};

/* ================= voice conversation ================= */
const tts=window.speechSynthesis;const live={on:false,rec:null,speaking:false};
function paintOrb(){const state=window.voiceOrbState(voiceSession);document.body.classList.toggle('voice-on',!!voiceSession.active);const el=$('#voiceOrb');if(el){el.dataset.state=state;el.setAttribute('aria-label','Voice orb, '+state+'. Triple-tap to change the accent colour.')}const s=$('#orbStatus');if(s)s.textContent=state;if(voiceSession.active&&agent.live)$('#msg').disabled=false}
function applyPersonality(p){p=['cynical','precise','warm'].includes(p)?p:'cynical';localStorage.valetPersonality=p;const s=$('#personality');if(s&&s.value!==p)s.value=p;const prov=$('#provider');if(prov)prov.textContent=(voiceSession.active?'Live':B.mode=='mock'?'Text on this device':'Text')+' · '+p}
let accent=parseInt(localStorage.valetAccent||'0',10)||0;
function applyAccent(i){accent=((i%4)+4)%4;localStorage.valetAccent=String(accent);document.documentElement.dataset.accent=['brass','cyan','violet','clay'][accent]}
applyAccent(accent);
function browserVoices(){if(!tts)return Promise.resolve([]);const list=()=>tts.getVoices();if(list().length)return Promise.resolve(list());
 return new Promise(resolve=>{let done=false;const finish=()=>{if(done)return;done=true;tts.removeEventListener('voiceschanged',finish);resolve(list())};tts.addEventListener('voiceschanged',finish);setTimeout(finish,600)})}
function finishSpokenReply(){if(live.speakTimer){clearTimeout(live.speakTimer);live.speakTimer=0}live.speaking=false;window.finishSpeakingReply(voiceSession);paintOrb();if(voiceSession.active&&!voiceSession.muted)listen()}
function say(text){if(!text)return;if(!tts||voiceSession.muted){window.beginSpeakingReply(voiceSession);window.finishSpeakingReply(voiceSession);paintOrb();if(voiceSession.active&&!voiceSession.muted)listen();return}
 try{live.rec&&live.rec.abort()}catch{}
 browserVoices().then(voices=>{if(!voiceSession.active||voiceSession.muted){paintOrb();return}
  if(!voices.length){window.beginSpeakingReply(voiceSession);window.finishSpeakingReply(voiceSession);paintOrb();if(!live.noSpokenVoice){live.noSpokenVoice=true;sys('This browser has no spoken voice, so Bags replies in text.')}if(voiceSession.active&&!voiceSession.muted)listen();return}
  window.beginSpeakingReply(voiceSession);live.speaking=true;paintOrb();
  const utterance=new SpeechSynthesisUtterance(text);utterance.lang='en-GB';const british=voices.find(voice=>/^en-GB/i.test(voice.lang));if(british)utterance.voice=british;
  let settled=false;const done=()=>{if(settled)return;settled=true;finishSpokenReply()};utterance.onend=utterance.onerror=done;
  live.speakTimer=setTimeout(done,Math.min(25000,1200+text.length*70));try{tts.speak(utterance)}catch{done()}})}
function listen(){const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;if(!voiceSession.active||voiceSession.speaking||voiceSession.muted||voiceSession.processing||!Recognition)return;
 const recognition=new Recognition();live.rec=recognition;recognition.lang='en-GB';recognition.interimResults=true;
 recognition.onstart=()=>{window.noteMicrophoneOpen(voiceSession);paintOrb()};
 recognition.onresult=event=>{let finalText='',partialText='';for(const result of event.results)result.isFinal?finalText+=result[0].transcript:partialText+=result[0].transcript;const partial=$('#partial');if(partial)partial.textContent=partialText;const spoken=finalText.trim();if(!spoken)return;if(partial)partial.textContent='';window.captureSpokenLine(voiceSession,spoken);paintOrb();add('me',spoken,'You · voice');send(spoken,{voice:true,transcribed:true})};
 recognition.onerror=event=>{const code=event&&event.error;if(!code||code=='aborted'||code=='no-speech')return;
  if(code=='not-allowed'||code=='service-not-allowed'){window.noteVoiceError(voiceSession,'Microphone permission denied');live.on=false;paintLive();paintOrb();sys('Microphone permission was denied. Typing still works.');return}
  if(code=='audio-capture'){window.noteVoiceError(voiceSession,'No microphone');live.on=false;paintLive();paintOrb();sys('No microphone was found. Typing still works.');return}
  if(!live.recognitionNote){live.recognitionNote=true;sys('Speech recognition stopped ('+code+'). You can keep typing, or tap Live to try again.')}};
 recognition.onend=()=>{window.noteMicrophoneClosed(voiceSession);paintOrb();if(voiceSession.active&&!voiceSession.speaking&&!voiceSession.muted&&!voiceSession.processing)setTimeout(listen,300)};
 try{recognition.start()}catch{}}
function paintLive(){const on=!!voiceSession.active;$('#liveBtn').setAttribute('aria-pressed',on);$('#liveBtn').setAttribute('aria-label',on?'End live':'Start live');$('#liveLbl').textContent='Live';$('.fab-slot').classList.toggle('on',on);setConn()}
function startLive(quiet){go('chat');const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;if(!Recognition){sys('This browser has no speech recognition. You can keep typing. Chrome can listen.');return}
 if(!agent.live)return sys(agent.name+' is away.');window.beginVoiceSession(voiceSession);live.on=true;$('#msg').disabled=false;paintLive();paintOrb();if(!quiet)sys('Live on. Speak, or keep typing. The microphone pauses while Bags speaks.');listen()}
function stopLive(){if(!voiceSession.active&&!live.on)return;window.endVoiceSession(voiceSession);live.on=false;live.speaking=false;if(live.speakTimer){clearTimeout(live.speakTimer);live.speakTimer=0}try{live.rec&&live.rec.abort()}catch{}tts&&tts.cancel();const partial=$('#partial');if(partial)partial.textContent='';paintLive();paintOrb();sys('Live off.');B.ws?.readyState==1&&B.ws.send('{"type":"interrupt"}')}
function paintMute(){const b=$('#muteBtn');if(!b)return;b.setAttribute('aria-pressed',voiceSession.muted);b.setAttribute('aria-label',voiceSession.muted?'Unmute Bags':'Mute Bags');b.textContent=voiceSession.muted?'Unmute':'Mute'}
$('#muteBtn').onclick=()=>{if(voiceSession.muted)window.unmuteVoice(voiceSession);else window.muteVoice(voiceSession);if(voiceSession.muted){if(live.speakTimer){clearTimeout(live.speakTimer);live.speakTimer=0}try{live.rec&&live.rec.abort()}catch{}tts&&tts.cancel();live.speaking=false}else if(voiceSession.active)listen();paintMute();paintOrb()};
let orbTaps=0,orbTapAt=0;
$('#voiceOrb').onclick=()=>{const now=Date.now();orbTaps=now-orbTapAt<450?orbTaps+1:1;orbTapAt=now;if(orbTaps>=3){orbTaps=0;applyAccent(window.cycleAccent(accent))}};
$('#liveBtn').onclick=()=>voiceSession.active?stopLive():startLive();
document.addEventListener('visibilitychange',()=>{if(document.hidden){stopLive();if(mr)recStop(true)}});// sensors never keep running in background

/* ================= voice notes: hold to record ================= */
const recBtn=$('#rec');let mr,chunks,stream,noteSR,noteText,t0,timer,cancelled,starting=false,pressed=false;
const fallback=m=>{sys(m+' You can still type your message.');$('#msg').focus()};
async function recStart(e){e.preventDefault();pressed=true;if(starting||mr)return;if(live.on)stopLive();
 if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)return fallback('Voice notes are not supported in this browser.');
 starting=true;try{stream=await navigator.mediaDevices.getUserMedia({audio:true})}catch(err){starting=false;pressed=false;return fallback(err.name=='NotAllowedError'?'Microphone permission was denied, so the voice note was not recorded.':'No microphone is available.')}
 starting=false;if(!pressed){stream.getTracks().forEach(t=>t.stop());return sys('Hold the mic button to record.')}
 chunks=[];cancelled=false;noteText='';mr=new MediaRecorder(stream);mr.ondataavailable=d=>d.data.size&&chunks.push(d.data);mr.onstop=finish;mr.start();
 if(SR){noteSR=new SR();noteSR.lang='en-GB';noteSR.continuous=true;noteSR.interimResults=true;noteSR.onresult=e=>{let f='',p='';for(const r of e.results)r.isFinal?f+=r[0].transcript:p+=r[0].transcript;noteText=f;$('#partial').textContent=(f+' '+p).trim()};try{noteSR.start()}catch{}}
 t0=Date.now();recBtn.classList.add('rec');$('#recHint').hidden=false;timer=setInterval(()=>{const s=Math.floor((Date.now()-t0)/1e3);$('#recTime').textContent=Math.floor(s/60)+':'+String(s%60).padStart(2,'0');if(s>=120)recStop()},250)}
function recStop(cancel){pressed=false;if(!mr)return;cancelled=!!cancel;clearInterval(timer);recBtn.classList.remove('rec');$('#recHint').hidden=true;try{noteSR&&noteSR.stop()}catch{};mr.state!='inactive'&&mr.stop();stream.getTracks().forEach(t=>t.stop())}
function finish(){const dur=(Date.now()-t0)/1e3,blob=new Blob(chunks,{type:mr.mimeType||'audio/webm'});mr=null;
 setTimeout(()=>{const txt=(noteText||$('#partial').textContent||'').trim();$('#partial').textContent='';
  if(cancelled)return sys('Voice note cancelled.');if(dur<0.6)return sys('Too short. Hold the mic button while you speak.');
  add('me',txt,`You · voice note ${dur.toFixed(1)}s`,{audio:URL.createObjectURL(blob),note:SR?'No speech detected':'Transcript unavailable in this browser'});
  send(txt,{voice:true,duration:+dur.toFixed(1),transcribed:!!txt})},400)}
recBtn.addEventListener('pointerdown',recStart);recBtn.addEventListener('pointerup',()=>recStop(false));
recBtn.addEventListener('pointerleave',()=>pressed&&recStop(true));recBtn.addEventListener('pointercancel',()=>recStop(true));recBtn.addEventListener('contextmenu',e=>e.preventDefault());
recBtn.addEventListener('keydown',e=>{if((e.key==' '||e.key=='Enter')&&!e.repeat)recStart(e)});recBtn.addEventListener('keyup',e=>{if(e.key==' '||e.key=='Enter')recStop(false)});

/* ================= meetings (companion /api/meetings) ================= */
const nm=id=>(allAgents().find(a=>a.id==id)||{name:id}).name;
$('#mCreate').onclick=async()=>{const r=await api('meetings',{method:'POST',body:{project:'Meeting',agenda:'Opened from Activities.',participants:['bagheera_butler.agent'],context_approved:true,confirmed:true}});
 if(!r.ok)return alert(r.status==401?'Sign in first.':'Could not open the meeting ('+(r.data.error||r.status)+').');loadMeetings();openMeeting(r.data.id)};
async function loadMeetings(){const r=await api('meetings');$('#mList').innerHTML=(r.data.meetings||[]).map(m=>`<button class="card agent" data-m="${esc(m.id)}"><b>${esc(m.project)}</b><span class="r">On this server</span></button>`).join('')||'<p class="note">No meetings yet.</p>';
 $('#mList').querySelectorAll('[data-m]').forEach(b=>b.onclick=()=>openMeeting(b.dataset.m))}
async function openMeeting(id){const m=(await api('meetings/'+id)).data,P=m.participants||[],E=m.entries||[];const pid=p=>typeof p=='string'?p:p.id;
 $('#mView').innerHTML=`<div class="card"><b>${esc(m.project)}</b><p class="note">${esc(m.agenda)}</p>
 <div>${E.map(e=>`<div class="card"><div class="m">${esc(e.kind)}</div>${esc(e.text)}</div>`).join('')||'<p class="note">No notes yet.</p>'}</div>
 <textarea id="eText" rows="2" aria-label="Meeting note"></textarea><button id="eAdd" class="primary">Add note</button>
 <div class="row"><button id="eMin">Download minutes</button><button class="danger" id="eDel">Erase meeting</button></div></div>`;
 $('#eAdd').onclick=async()=>{const r=await api(`meetings/${id}/entries`,{method:'POST',body:{kind:'note',text:$('#eText').value,confirmed:true}});if(!r.ok)alert('Could not add: '+(r.data.error||r.status));openMeeting(id)};
 $('#eMin').onclick=async()=>{let txt;if(B.mode=='server'){const r=await fetch(U(`api/meetings/${id}/minutes`),{headers:{Authorization:'Bearer '+B.token}});txt=await r.text()}else txt=[`# ${m.project}`,'',`Agenda: ${m.agenda}`,'','Participants: '+P.map(p=>nm(pid(p))).join(', '),'',...E.map(e=>`- [${e.kind}] ${e.text} (recorded by user)`),'','Recorded in Valet.'].join('\n');
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([txt],{type:'text/markdown'}));a.download='minutes.md';a.click()};
 $('#eDel').onclick=async()=>{if(confirm('Erase this meeting workspace?')){await api('meetings/'+id,{method:'DELETE'});$('#mView').innerHTML='';loadMeetings()}}}

/* ================= tasks (companion /api/tasks + /api/events) ================= */
let cursor=0;
$('#tStatus').onclick=async()=>{const r=await api('tasks',{method:'POST',body:{action:'server_status',confirmed:true}});if(!r.ok)sys(r.status==401?'Pair this device first.':'Task refused: '+(r.data.error||r.status));loadTasks()};
async function loadTasks(){const r=await api('tasks');$('#tList').innerHTML=(r.data.tasks||[]).map(t=>{const detail=t.result&&typeof t.result=='object'?(t.result.detail||''):(t.result||'');const name=t.action=='server_status'?'Status check':t.action;return `<div class="card"><b>${esc(name)}</b><div class="m">${esc(t.status)}${detail?' · '+esc(detail):''}</div></div>`}).join('')||'<p class="note">No tasks yet.</p>'}
setInterval(async()=>{if(document.hidden||(B.mode=='server'&&!B.token)||B.mode=='detecting')return;const r=await api('events?after='+cursor);if(!r.ok)return;for(const e of r.data.events||[]){if(e.type=='call.incoming'){incoming({from:e.agent_id||'bags',why:e.speech||'',source:'server'});continue}sys(e.speech||e.type);loadTasks()}cursor=r.data.next_cursor??cursor},3000);

$('#themeBtn').onclick=()=>setTheme(root.dataset.theme=='light'?'dark':'light');document.querySelector('meta[name=theme-color]');

/* ================= calls: incoming agent calls, answer starts a voice conversation ================= */
// Companion backend today emits only task.completed / task.failed events. A 'call.incoming' event
// A call.incoming event is shown if a server sends one. The ring button on this screen asks Bags to ring locally.
let calls=JSON.parse(localStorage.valetCalls||'[]'),ringing=null,inCall=null;
const saveCalls=()=>{localStorage.valetCalls=JSON.stringify(calls.slice(0,50))};
const REASONS=['Your evening briefing is ready.','Two activities need a decision.','A meeting has new action items.','Quick check-in on today.'];
let ac;function ringTone(on){try{if(!on){ac&&ac.close();ac=null;return}ac=new (window.AudioContext||window.webkitAudioContext)();const o=ac.createOscillator(),g=ac.createGain();o.frequency.value=660;o.connect(g);g.connect(ac.destination);g.gain.value=0;o.start();
 const t=ac.currentTime;for(let i=0;i<30;i++){g.gain.setValueAtTime(0,t+i*2);g.gain.linearRampToValueAtTime(.06,t+i*2+.05);g.gain.setValueAtTime(.06,t+i*2+.8);g.gain.linearRampToValueAtTime(0,t+i*2+.9)}}catch{}}
function callAgent(id){return allAgents().find(a=>a.id==id)||ORG.personal}
function incoming(c){if(ringing||inCall)return;const a=callAgent(c.from);if(!a.live){calls.unshift({id:Date.now(),from:a.id,name:a.name,at:Date.now(),status:'missed',note:'agent disconnected'});saveCalls();return}
 ringing={id:Date.now(),from:a.id,name:a.name,at:Date.now(),why:c.why||REASONS[Math.floor(Math.random()*REASONS.length)],source:c.source||'local'};
 $('#callWho').textContent=a.name;$('#callAvatar').textContent=a.name[0];$('#callState').textContent='Incoming call';$('#callWhy').textContent=ringing.why;
 $('#callSheet').classList.remove('live');$('#answerBtn').parentElement.hidden=false;$('#declineBtn').setAttribute('aria-label','Decline call');$('#declineBtn').nextElementSibling.textContent='Decline';
 $('#callSheet').hidden=false;$('#answerBtn').focus();ringTone(true);navigator.vibrate&&navigator.vibrate([400,200,400]);
 ringing.timer=setTimeout(()=>endRing('missed'),30000)}
function endRing(status){if(!ringing)return;clearTimeout(ringing.timer);ringTone(false);navigator.vibrate&&navigator.vibrate(0);
 const c={id:ringing.id,from:ringing.from,name:ringing.name,at:ringing.at,status,why:ringing.why};calls.unshift(c);saveCalls();ringing=null;
 if(status!='answered')$('#callSheet').hidden=true;$('#callBadge').hidden=!calls.some(x=>x.status=='missed'&&!x.seen);renderCalls();return c}
$('#declineBtn').onclick=()=>{if(inCall){hangUp();return}endRing('declined')};
$('#answerBtn').onclick=()=>{const c=endRing('answered');inCall=c;const a=callAgent(c.from);if(a.id!=agent.id)pick(a);
 $('#callSheet').classList.add('live');$('#callState').textContent='On call · hands-free';$('#answerBtn').parentElement.hidden=true;$('#declineBtn').setAttribute('aria-label','End call');$('#declineBtn').nextElementSibling.textContent='End call';
 const hello=`Hello, sir. ${a.name} here. ${c.why} I'm listening.`;add('bot',hello,a.name+' · call');startLive(true);say(hello)};
function hangUp(){inCall=null;$('#callSheet').hidden=true;stopLive()}
function renderCalls(){calls.forEach(c=>c.seen=true);saveCalls();$('#callBadge').hidden=true;
 $('#callNote').textContent='Only Bags can ring from this screen. No other agents are connected.';
 $('#callLog').innerHTML=calls.length?`<div class="glass unit calllog">${calls.map(c=>`<button class="agent" data-c="${c.id}"><b>${esc(c.name)}</b><span class="r">${new Date(c.at).toLocaleString([], {weekday:'short',hour:'2-digit',minute:'2-digit'})}${c.why?' · '+esc(c.why):''}</span><span class="st ${c.status}">${c.status=='missed'?'Missed':c.status=='answered'?'Answered':'Declined'}</span></button>`).join('')}</div>`:'<p class="note">No calls yet.</p>';
 $('#callLog').querySelectorAll('[data-c]').forEach(b=>b.onclick=()=>{const c=calls.find(x=>x.id==b.dataset.c);pick(callAgent(c.from))})}
$('#simCall').onclick=()=>setTimeout(()=>incoming({from:ORG.personal.id,source:'local'}),600);

/* ================= boot: plain chat, greeting, nothing live ================= */
$('#agentHdr').textContent=P.name+' · '+ORG.personal.role;
applyPersonality(currentPersonality());
tree();paintLive();paintOrb();
detect().then(()=>{greetIfEmpty();if(B.mode=='mock')mockApi('events?after=0').then(r=>cursor=r.data.next_cursor||0)});
$('#callBadge').hidden=!calls.some(x=>x.status=='missed'&&!x.seen);
