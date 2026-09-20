# QuickSubmit partial-save incident — 2026-09-18

## Summary

QuickSubmit on `journals.kmanpub.com` was reported to intermittently create submissions where contributor/author data survives but title, abstract, and other article metadata must be entered again. The same pattern has been reported on newly-created journals.

The leading failure model is a **partial save across multiple requests**. It is supported by the plugin's persistence flow, but the exact production-side trigger still needs correlation with proxy/PHP/OJS logs.

Operational tracking: `ojs-inator/kmanweb-ci#173`.

## Why authors can survive while metadata disappears

QuickSubmit does not behave as one atomic write:

1. Opening the form calls `QuickSubmitForm::initData()`, which immediately creates a draft submission and publication.
2. Contributors and galleys are persisted through separate AJAX requests while the form is open.
3. Title, abstract, locale, keywords, and most publication metadata are persisted later by the final `saveSubmit` POST through `SubmissionMetadataForm::execute()`.
4. If that final request fails, times out, or crashes, the earlier writes remain.

This means a 500/504/505-class failure on the final POST can naturally produce the reported state: an existing submission with an author, but missing or stale publication metadata.

The test suite previously did not detect this. The unpublished Cypress case only checked that the resulting workflow showed "Schedule For Publication"; it never reloaded the publication and verified title/abstract/locale from the persisted API state.

## Production evidence still required

The next reproduction should be tied to one submission ID and timestamp. Capture before restarting or redeploying:

- browser/network result for the final `saveSubmit` POST;
- reverse-proxy HTTP status and upstream timing;
- PHP/OJS error log for the same request;
- deployed QuickSubmit git SHA and plugin bundle hash;
- OJS and PHP versions;
- submission, publication, and contributor rows after the failed request.

An earlier investigation, `ojs-inator/kmanweb-ci#168`, targeted a QuickSubmit 500 on journalcbl but could not collect live evidence because the k5 self-hosted runner was unavailable.

## Repository/CI findings

At the time of this incident:

- `main` had no open PRs or issues in this fork. GitHub Issues are disabled for this repository, so the operational incident is tracked in `kmanweb-ci#173`.
- `main` contained recent OJS 3.4 compatibility patches:
  - `cbee1b6` — OJS 3.4 user-group/stage-assignment compatibility;
  - `c7a6eca` — OJS 3.4 metadata/controlled-vocabulary save compatibility;
  - `c9fa03a` — queued publication status compatibility.
- Despite those OJS 3.4 patches, the `main` workflow tested only OJS `main`.
- This repository has a separate `stable-3_4_0` branch and it is materially diverged from `main`. Therefore compatibility changes made on `main` were not being exercised against OJS 3.4 before merge.

## Related upstream issues reviewed

- `pkp/quickSubmit#92` — multilingual "Choose a language" failure, including OJS 3.4 reports.
- `pkp/quickSubmit#80` — submission and metadata language handling.
- `pkp/quickSubmit#114` — incorrect max-sequence calculation after publication.

The max-sequence bug from #114 was present in this fork and is corrected in this PR.

## Additional deterministic bug found

The current `main` publication path treated the `NO_ISSUE` sentinel as a real issue ID:

```php
$issue = Repo::issue()->get((int) $this->getData('issueId'), ...);
$issue->getData('published');
```

For `NO_ISSUE = 0`, this can dereference `null`. The fix never resolves the sentinel as an issue and only applies future-issue status handling to an actual issue. OJS 3.5-only ready/schedule status constants are guarded so the compatibility path does not fatal on OJS 3.4.

## Regression coverage added

The Cypress happy paths now:

- capture the final `saveSubmit` request;
- fail explicitly on HTTP 500/504/505 or any other non-success status, including the response body in the assertion message;
- capture the draft `submissionId`;
- reload the saved submission through the OJS API;
- reload the current publication through the OJS API;
- assert that title, abstract, locale, and contributor all persisted together;
- perform the same persistence check for the unpublished path, which directly targets the production symptom;
- replace the arbitrary post-save sleep with a request-level synchronization point.

## Local validation — 2026-09-20

- OJS `stable-3_4_0`, PHP 8.1, MySQL, Node 16.18.1, and the official dataset;
- `QuickSubmit.cy.js`: 2 passing, 0 failing;
- both published and unpublished final save requests returned HTTP 200;
- API round-trip confirmed locale, title, abstract, and contributor persistence.

The original intermittent production 5xx root cause remains unconfirmed because no production failure has yet been correlated with proxy, PHP, and OJS logs.

## Remaining hardening

The next useful additions are:

1. a dedicated multilingual fixture covering upstream #92/#80;
2. an explicit future-issue / continuous-publication scenario;
3. a deterministic transient final-save test that injects a 504/505 response and verifies the UI does not report success and can safely retry without losing typed metadata;
4. CI artifact collection for PHP/OJS logs when Cypress fails;
5. a production/staging smoke check that records the deployed plugin SHA/bundle hash alongside the request result.

The first priority remains obtaining one production failure with correlated `saveSubmit`, proxy, and PHP/OJS evidence. Without that, the partial-save mechanism is well explained but the source of the intermittent 5xx remains unconfirmed.
