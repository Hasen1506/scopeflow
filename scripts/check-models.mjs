// Model-lifecycle guard (daily, from the Render cron): checks that each configured AI model is still
// served (the provider's Models API) and warns 45 days before a known retirement date. Prints one JSON
// line; exits 1 with --strict when a model is missing or retired, so it can gate a deploy.
// Without OPENAI_API_KEY or ANTHROPIC_API_KEY there is nothing to check.
import {checkModels} from '../lib/llm.ts';

const results = await checkModels();
const problems = results.filter(r => r.status === 'missing' || (r.warning && r.warning.includes('was retired')));
for (const r of results) if (r.warning) console.warn(`[scopeflow:models] ${r.warning}`);
console.log(JSON.stringify({checked: results.length, models: results, problems: problems.length}));
if (process.argv.includes('--strict') && problems.length) process.exit(1);
