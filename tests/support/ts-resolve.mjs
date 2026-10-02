// Lets `node tests/unit.mjs` import lib/*.ts, which use extensionless relative imports.
import {registerHooks} from 'node:module';
registerHooks({
 resolve(specifier,context,next){
  if(/^\.{1,2}\//.test(specifier)&&!/\.[cm]?[jt]s$/.test(specifier)){try{return next(specifier+'.ts',context);}catch{/* fall through */}}
  return next(specifier,context);
 },
});
