import {db,json,owner,parseRow,failure} from '@/lib/server';
type Ctx={params:Promise<{id:string}>};
export async function GET(request:Request,ctx:Ctx){try{
 const user=await owner(request);if(!user)return json({error:'Sign in or provide a valid API token.'},401);
 const {id}=await ctx.params;
 // Read authorization and all project records in one database snapshot.
 const [projects,versions,entries]=await db().batch<Record<string,unknown>>([
  db().prepare('SELECT id FROM projects WHERE id=? AND owner=?').bind(id,user),
  db().prepare('SELECT v.* FROM versions v JOIN projects p ON p.id=v.project_id WHERE p.id=? AND p.owner=? ORDER BY v.version DESC').bind(id,user),
  db().prepare('SELECT e.* FROM ledger_entries e JOIN projects p ON p.id=e.project_id WHERE p.id=? AND p.owner=? ORDER BY e.seq').bind(id,user),
 ]);
 if(!projects.results.length)return json({error:'Project not found.'},404);
 return json({exported_at:new Date().toISOString(),format_version:1,project_id:id,versions:versions.results.map(parseRow),ledger_entries:entries.results.map(e=>({...e,payload:JSON.parse(e.payload as string)}))});
}catch(e){return failure(e);}}
