# Cron jobs on GitHub Actions

The web service stays on Render **Starter** (about US$7/month) so a client review link opens without a
cold start. Koyeb's free instance is not used. Checked 19 October 2026:

- [Instances](https://www.koyeb.com/docs/reference/instances) (updated 27 May 2026): the free instance
  scales down to zero when it receives no traffic for 1 hour. Sleep cannot be turned off.
- [Scale to zero](https://www.koyeb.com/docs/run-and-scale/scale-to-zero) (updated 27 May 2026): that
  idle period cannot be changed. Deep sleep then takes 1–5 seconds to create a new microVM. That is a
  cold start. Light sleep (about 200 ms) is for paid plans.
- [Pricing](https://www.koyeb.com/pricing) and the [pricing FAQ](https://www.koyeb.com/docs/faqs/pricing):
  the free web service is one `free` instance in Frankfurt or Washington, D.C.

## The four workflows

Same UTC clocks the Render cron services used. Each runs `node scripts/cron.mjs <jobs>`, with
`workflow_dispatch` and a concurrency group (`cancel-in-progress: false`).

| Workflow | Clock (UTC) | Command | Render service to delete |
| --- | --- | --- | --- |
| `.github/workflows/cron-retention.yml` | `30 20 * * *` (02:00 IST) | `node scripts/cron.mjs retention heads housekeeping` | `scopeflow-retention` |
| `.github/workflows/cron-reminders.yml` | `30 3 * * *` (09:00 IST) | `node scripts/cron.mjs reminders` | `scopeflow-reminders` |
| `.github/workflows/cron-reconcile.yml` | `0 */6 * * *` | `node scripts/cron.mjs reconcile` | `scopeflow-reconcile` |
| `.github/workflows/cron-check-models.yml` | `0 22 * * *` | `node scripts/cron.mjs check-models analytics` | `scopeflow-check-models` |

`APP_URL` in each workflow is `https://scope-flow.tech`. A public repository does not spend minutes on
the standard GitHub-hosted runners.

GitHub runs `schedule` only from the default branch (`main`). It may start a run later than the clock.
It disables scheduled workflows after 60 days without repository activity
([schedule events](https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows#schedule)).
A push, or someone using the repository, keeps them enabled. **Run workflow** is the catch-up. These
files do not add a dummy job to defeat that rule.

Until `DATABASE_URL` is set, each workflow passes with a notice and does not touch the database. On
failure, if `SCOPEFLOW_ERROR_WEBHOOK` is set, the workflow POSTs `{source, id, message, at}` and nothing
else.

## Checklist

1. Add these repository secrets (Settings → Secrets and variables → Actions). Use the same values as the Render web service.
   - `DATABASE_URL` (app role)
   - `SCOPEFLOW_CRON_SECRET`
   - `SCOPEFLOW_ADMIN_TOKEN`
   - `SCOPEFLOW_CONTEXT_RETENTION_DAYS` when the retention job should use a server default
   - Reminders: `RESEND_API_KEY`, `SCOPEFLOW_MAIL_FROM`, `SCOPEFLOW_MAIL_REPLY_TO`, `SCOPEFLOW_MAIL_PROVIDER`, `POSTMARK_SERVER_TOKEN`, `SCOPEFLOW_SES_ACCESS_KEY_ID`, `SCOPEFLOW_SES_SECRET_ACCESS_KEY`, `SCOPEFLOW_SES_REGION`
   - Check-models: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `POSTHOG_KEY`
   - Optional: `SCOPEFLOW_ERROR_WEBHOOK`
2. After these workflow files are on `main`, open Actions and run each of the four workflows once.
3. Confirm each run is green and `/api/readiness` shows `checks.cron.jobs` for `retention`, `heads`, `housekeeping`, `reminders`, `reconcile`, `check-models`, and `analytics`.
4. Delete these Render cron services: `scopeflow-retention`, `scopeflow-reminders`, `scopeflow-reconcile`, `scopeflow-check-models`. Leave the web service `scopeflow` on Starter.

Do step 4 after step 3, before the next clock, so Render and Actions do not both run the same hour. The jobs are idempotent if one overlap happens. The web service is not part of this delete list.
