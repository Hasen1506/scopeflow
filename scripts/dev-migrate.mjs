// Apply drizzle/*.sql to the local `npm run dev` D1 database (Miniflare state).
// Local development only; production migrations go through the Sites tooling.
import {DatabaseSync} from 'node:sqlite';
import {readdirSync,readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

export function applyMigrations(db,directory){
 db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS _local_migrations (name TEXT PRIMARY KEY)');
 const applied=[];
 for(const name of readdirSync(directory).filter(f=>f.endsWith('.sql')).sort()){
  if(db.prepare('SELECT 1 FROM _local_migrations WHERE name=?').get(name))continue;
  db.exec('BEGIN IMMEDIATE');
  try{
   for(let statement of readFileSync(path.join(directory,name),'utf8').split('--> statement-breakpoint')){
    if(!statement.trim())continue;
    // Earlier preview schemas may exist without this helper's migration journal.
    statement=statement.replace(/CREATE TABLE\s+`/i,'CREATE TABLE IF NOT EXISTS `').replace(/CREATE (UNIQUE )?INDEX\s+`/i,(_,unique)=>'CREATE '+(unique||'')+'INDEX IF NOT EXISTS `');
    const add=statement.match(/ALTER TABLE\s+`([^`]+)`\s+ADD(?: COLUMN)?\s+`([^`]+)`/i);
    if(add&&db.prepare('SELECT name FROM pragma_table_info(?) WHERE name=?').get(add[1],add[2]))continue;
    db.exec(statement);
   }
   db.prepare('INSERT INTO _local_migrations VALUES (?)').run(name);db.exec('COMMIT');applied.push(name);
  }catch(e){db.exec('ROLLBACK');throw e;}
 }
 return applied;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const root=fileURLToPath(new URL('../',import.meta.url));
 const dir=path.join(root,'.wrangler/state/v3/d1/miniflare-D1DatabaseObject');
 const files=existsSync(dir)?readdirSync(dir).filter(f=>/^[0-9a-f]{64}\.sqlite$/.test(f)):[];
 if(files.length!==1)throw Error('Start npm run dev and load a page first. This helper requires exactly one local D1 database.');
 const db=new DatabaseSync(path.join(dir,files[0]));
 try{for(const name of applyMigrations(db,path.join(root,'drizzle')))console.log('applied',name);}finally{db.close();}
}
