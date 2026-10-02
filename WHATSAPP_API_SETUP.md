# Meta WhatsApp Cloud API — Setup Checklist

Once the four secrets in step 5 are in (plus the webhook secrets in step 6),
the WhatsApp system already built into Ambria Ops — contacts, templates,
campaigns, inbox, opt-outs, the "API Marketing" nav tab — starts working
with zero new code. This checklist just gets Meta's side connected.

---

## 1. Meta Business Manager
- [ ] Go to [business.facebook.com](https://business.facebook.com), create (or confirm you already have) a Business Portfolio for Ambria.
- [ ] Under **Business Settings → Business Info**, start **Business Verification** if not already verified (needs GST/incorporation docs, registered address, phone). Can take 1–3 days — kick this off first since everything else can proceed in parallel.

## 2. Create the Meta App
- [ ] [developers.facebook.com/apps](https://developers.facebook.com/apps) → **Create App** → type **Business**.
- [ ] Attach it to the Ambria Business Portfolio.
- [ ] In the app dashboard: **Add Product → WhatsApp → Set up**.

## 3. WhatsApp Business Account (WABA) + phone number
- [ ] The WhatsApp product setup creates a WABA (or lets you pick an existing one) and prompts you to add a phone number.
- [ ] Add the real number to send from. Meta sends an OTP — verify it.
- [ ] Set a **2-Step Verification PIN** for that number (WhatsApp Manager → the number → 2-Step Verification). Save this PIN somewhere durable — needed again if the number ever has to be re-registered.
- [ ] Note the **WABA ID** and **Phone Number ID** — both shown on the WhatsApp → API Setup page in the app dashboard.

## 4. System User + permanent access token
Don't use the temporary token the API Setup page shows by default — it expires in 24h.
- [ ] Business Settings → **Users → System Users** → **Add** → name it (e.g. "Ambria WA API"), role **Admin**.
- [ ] **Add Assets** → assign it the WhatsApp app (Full control) and the WABA (Full control).
- [ ] **Generate New Token** on that system user → select the app → scopes: `whatsapp_business_management` + `whatsapp_business_messaging` → Generate. Doesn't expire on its own (only if revoked).
- [ ] Copy it now — Meta only shows it once.

## 5. Set the four values as Supabase secrets
Supabase dashboard → Edge Functions → Secrets (or via CLI):

| Secret name | Value |
|---|---|
| `WA_WABA_ID` | the WABA ID from step 3 |
| `WA_PHONE_NUMBER_ID` | the Phone Number ID from step 3 |
| `WA_ACCESS_TOKEN` | the system-user token from step 4 |
| `WA_API_VERSION` | optional — defaults to `v21.0` if skipped |

CLI form:
```
supabase secrets set WA_WABA_ID=xxx WA_PHONE_NUMBER_ID=xxx WA_ACCESS_TOKEN=xxx
```

## 6. Webhook (delivery statuses, inbound replies, STOP keyword handling)
- [ ] Pick any random secret string for `WA_WEBHOOK_VERIFY_TOKEN` (just something only you know) and set it as a Supabase secret.
- [ ] Get `WA_APP_SECRET` from the app dashboard → **App Settings → Basic** → "App Secret" (click Show). Set it as a Supabase secret.
- [ ] `supabase functions deploy wa-webhook wa-send wa-account-info wa-template-meta`
- [ ] In the app dashboard → WhatsApp → **Configuration**, set the webhook Callback URL to the deployed `wa-webhook` function's URL, Verify Token = same string as `WA_WEBHOOK_VERIFY_TOKEN`. Click Verify and Save.
- [ ] Subscribe to at least the `messages` webhook field.
- [ ] **Subscribe the WABA itself to the app** — verifying the Callback URL only tells Meta the app's webhook endpoint; it does NOT automatically link any particular WABA to it. Without this step inbound messages never arrive, with no error anywhere — the URL shows "Verified" and everything else looks fine. Check with:
  ```
  curl "https://graph.facebook.com/v21.0/<WABA_ID>/subscribed_apps" -H "Authorization: Bearer <system-user token>"
  ```
  If `data` comes back empty, subscribe it:
  ```
  curl -X POST "https://graph.facebook.com/v21.0/<WABA_ID>/subscribed_apps" -H "Authorization: Bearer <system-user token>"
  ```
  (`<WABA_ID>` is the "WhatsApp Business account ID" shown on the API Setup page — double-check every digit against that page; a single mistyped digit returns a generic "object does not exist" error that looks identical to a real permissions problem.)

## 7. Smoke test
- [ ] Call `wa-account-info` (from the app's "API Marketing" → Settings screen, or directly) — confirms the token/WABA/number are all wired correctly.
- [ ] Submit one template for approval (via `wa-template-meta` or directly in WhatsApp Manager → Message Templates) — usually minutes to a few hours.
- [ ] Once approved, send a real test message via `wa-send` from the Campaigns/Templates screen.

---

**Existing edge functions this all wires into:** `wa-send`, `wa-webhook`, `wa-account-info`, `wa-template-meta`
(`supabase/functions/`) — reads the six secrets above via `Deno.env.get(...)`.
No code changes needed once these are set; only redeploy after setting new
secrets if the functions were deployed before the secrets existed.
