# Templates library and AI drafting

- **Starter templates** (`lib/templates.ts`): brand identity, website, content package, mobile app, monthly SEO
  retainer, video production, website copywriting, strategy workshop. Applying one stages it in the editor,
  where everything is editable.
- **Your templates**: "Save this draft as a template" (`POST /api/templates`), update a template you started
  from (`PUT /api/templates/<id>`), delete (`DELETE`). Private to the owner, up to 50, deleted with the account.
  Built-ins are read-only (409 `builtin`): save an edited copy instead. `GET /api/templates` lists both.
- **AI drafting** (`POST /api/draft {"brief": "...", "currency": "INR"}`): sends the brief to OpenAI or Anthropic
  with Scopeflow's scope shape, coerces the reply into valid content (ids assigned by the server), runs the
  clarity linter and returns an **unsaved** draft. Off unless `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` is set
  (OpenAI wins when both; `SCOPEFLOW_LLM_PROVIDER` forces one; `SCOPEFLOW_OPENAI_MODEL` /
  `SCOPEFLOW_ANTHROPIC_MODEL` override the defaults `gpt-4o-mini` / `claude-haiku-4-5`). Without a key the
  endpoint answers 503 `ai_disabled` and the editor shows the control disabled with that explanation.
- The privacy notice now says exactly when a brief is sent to an AI provider.
