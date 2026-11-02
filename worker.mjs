const ORIGIN='https://mengzhen88.github.io';
function hex(bytes){return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('')}
function secret(){const bytes=new Uint8Array(32);crypto.getRandomValues(bytes);return hex(bytes)}
async function hash(text){return hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))))}
async function invitation(admin,id,slot){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(admin),{name:'HMAC',hash:'SHA-256'},false,['sign']);return hex(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(id+':'+slot))))}
class HttpError extends Error{constructor(status,message){super(message);this.status=status}}
function reply(data,status=200){return Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}})}
async function body(req){const raw=await req.text();if(raw.length>2048)throw new HttpError(413,'请求过长。');try{const data=JSON.parse(raw||'{}');if(!data||Array.isArray(data)||typeof data!=='object')throw Error();return data}catch{throw new HttpError(400,'请求格式有误。')}}
const tokenValid=t=>typeof t==='string'&&/^[a-f0-9]{64}$/.test(t);
async function verifyInvite(db,id,token){if(!tokenValid(token))throw new HttpError(403,'邀请链接无效，请向发起人索取专属链接。');const digest=await hash(token);const row=await db.prepare('SELECT slot FROM invitations WHERE room_id=? AND token_hash=?').bind(id,digest).first();if(!row)throw new HttpError(403,'邀请链接无效，请确认你打开了自己的专属邀请。');return {digest,slot:row.slot}}
async function ownResult(db,id,digest){return db.prepare('SELECT name,seat,created_at FROM allocations WHERE room_id=? AND token_hash=?').bind(id,digest).first()}
export async function handle(req,env){
 const url=new URL(req.url),db=env.DB;if(url.pathname==='/health')return reply({ok:!!db});
 if(!db)throw new HttpError(503,'抽签服务尚未配置完成，请稍后再试。');
 if(url.pathname==='/api/rooms'&&req.method==='POST'){
  await body(req);const id=crypto.randomUUID(),admin=secret(),tokens=await Promise.all([1,2,3,4,5].map(slot=>invitation(admin,id,slot))),digests=await Promise.all(tokens.map(hash));
  await db.batch([db.prepare('INSERT INTO rooms(id,admin_hash,created_at) VALUES (?,?,?)').bind(id,await hash(admin),Date.now()),...digests.map((t,i)=>db.prepare('INSERT INTO invitations(room_id,token_hash,slot) VALUES (?,?,?)').bind(id,t,i+1))]);
  return reply({id,admin,invitations:tokens},201);
 }
 const match=url.pathname.match(/^\/api\/rooms\/([a-f0-9-]{36})(?:\/(me|draw|admin))?$/);if(!match)throw new HttpError(404,'找不到该接口。');const [,id,action]=match;
 if(!action&&req.method==='GET'){
  if(!await db.prepare('SELECT id FROM rooms WHERE id=?').bind(id).first())throw new HttpError(404,'这轮抽签不存在。');
  const rows=await db.prepare('SELECT seat FROM allocations WHERE room_id=? ORDER BY created_at').bind(id).all();return reply({count:rows.results.length,seats:rows.results.map(r=>r.seat)});
 }
 if(req.method!=='POST')throw new HttpError(405,'不支持的请求方式。');const data=await body(req);
 if(action==='admin'){
  if(!tokenValid(data.admin))throw new HttpError(403,'管理员链接无效。');
  const r=await db.prepare('SELECT id FROM rooms WHERE id=? AND admin_hash=?').bind(id,await hash(data.admin)).first();if(!r)throw new HttpError(403,'管理员链接无效。');
  const result=await db.prepare('SELECT i.slot,a.name,a.seat,a.created_at FROM invitations i LEFT JOIN allocations a ON a.room_id=i.room_id AND a.token_hash=i.token_hash WHERE i.room_id=? ORDER BY i.slot').bind(id).all();
  const invitations=await Promise.all(result.results.map(async r=>({...r,token:await invitation(data.admin,id,r.slot)})));return reply({id,invitations});
 }
 const {digest,slot}=await verifyInvite(db,id,data.token);const previous=await ownResult(db,id,digest);if(action==='me')return reply({slot,draw:previous});
 if(action!=='draw')throw new HttpError(404,'找不到该接口。');
 // A consumed invitation always returns its ORIGINAL allocation, even when the
 // caller changes their submitted name or retries after a lost response.
 if(previous)return reply({draw:previous,alreadyDrawn:true});
 const name=typeof data.name==='string'?data.name.normalize('NFKC').trim().replace(/\s+/g,' '):'';
 if(!name||name.length>20)throw new HttpError(400,'请输入自己的名字，最多20字。');const nameKey=name.toLocaleLowerCase();
 // Selection and reservation happen in ONE database statement. Concurrent
 // devices cannot observe the same free seat and reserve it twice.
 await db.prepare(`INSERT OR IGNORE INTO allocations(room_id,token_hash,name,name_key,seat,created_at)
 SELECT ?,?,?,?,seat,? FROM (SELECT 178 AS seat UNION ALL SELECT 180 UNION ALL SELECT 181 UNION ALL SELECT 182 UNION ALL SELECT 183)
 WHERE seat NOT IN (SELECT seat FROM allocations WHERE room_id=?)
 AND NOT EXISTS (SELECT 1 FROM allocations WHERE room_id=? AND token_hash=?)
 AND NOT EXISTS (SELECT 1 FROM allocations WHERE room_id=? AND name_key=?)
 ORDER BY random() LIMIT 1`).bind(id,digest,name,nameKey,Date.now(),id,id,digest,id,nameKey).run();
 const allocated=await ownResult(db,id,digest);if(allocated)return reply({draw:allocated,alreadyDrawn:false});
 if(await db.prepare('SELECT 1 FROM allocations WHERE room_id=? AND name_key=?').bind(id,nameKey).first())throw new HttpError(409,'这个名字已经抽过。若你们同名，请加上能区分身份的称呼。');
 throw new HttpError(409,'本轮五个工位已经抽完。');
}
export default {async fetch(req,env){
 const origin=req.headers.get('Origin'),allowed=env.FRONTEND_ORIGIN||ORIGIN;
 if(origin&&origin!==allowed)return reply({error:'不允许来自该页面的请求。'},403);
 let response;if(req.method==='OPTIONS')response=new Response(null,{status:204});else try{response=await handle(req,env)}catch(e){response=reply({error:e instanceof HttpError?e.message:'服务暂时不可用，请稍后重试；已成功抽中的结果不会丢失。'},e instanceof HttpError?e.status:503)}
 const headers=new Headers(response.headers);headers.set('Access-Control-Allow-Origin',allowed);headers.set('Access-Control-Allow-Methods','GET,POST,OPTIONS');headers.set('Access-Control-Allow-Headers','Content-Type');headers.set('Vary','Origin');return new Response(response.body,{status:response.status,headers});
}};
