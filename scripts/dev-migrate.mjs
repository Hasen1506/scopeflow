// Apply drizzle/*.sql to the local `npm run dev` D1 database (Miniflare state).
// Local development only; production migrations go through the Sites tooling.
import {DatabaseSync} from 'node:sqlite';
import {readdirSync,readFileSync} from 'node:fs';
const root=new URL('..',import.meta.url).pathname;
const dir=root+'.wrangler/state/v3/d1/miniflare-D1DatabaseObject/';
const file=readdirSync(dir).find(f=>/^[0-9a-f]{64}\.sqlite$/.test(f));
if(!file)throw new Error('Start `npm run dev` and load a page once so the local database exists.');
const db=new DatabaseSync(dir+file);
db.exec('CREATE TABLE IF NOT EXISTS _local_migrations (name TEXT PRIMARY KEY)');
for(const name of readdirSync(root+'drizzle').filter(f=>f.endsWith('.sql')).sort()){
 if(db.prepare('SELECT 1 FROM _local_migrations WHERE name=?').get(name))continue;
 for(const statement of readFileSync(root+'drizzle/'+name,'utf8').split('--> statement-breakpoint'))if(statement.trim())db.exec(statement);
 db.prepare('INSERT INTO _local_migrations VALUES (?)').run(name);
 console.log('applied',name);
}
