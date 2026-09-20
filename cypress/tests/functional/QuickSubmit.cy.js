/**
 * @file cypress/tests/functional/QuickSubmit.cy.js
 *
 * Copyright (c) 2014-2023 Simon Fraser University
 * Copyright (c) 2000-2023 John Willinsky
 * Distributed under the GNU GPL v3. For full terms see the file LICENSE.
 *
 */

const finalSaveUrl = '**/QuickSubmitPlugin/saveSubmit*';

function saveAndAssertRequestSucceeded() {
	cy.intercept('POST', finalSaveUrl).as('quickSubmitFinalSave');
	cy.get('form[id="quickSubmitForm"] button:contains("Save")').click();

	cy.wait('@quickSubmitFinalSave').then(interception => {
		expect(interception.response, 'QuickSubmit final save response').to.exist;

		const status = interception.response.statusCode;
		const body = typeof interception.response.body === 'string'
			? interception.response.body
			: JSON.stringify(interception.response.body);

		expect(
			status,
			`QuickSubmit final save returned HTTP ${status}: ${body.slice(0, 1000)}`
		).to.be.within(200, 399);
	});
}

function assertPublicationRoundTrip(submissionId, expected) {
	cy.request({
		url: `index.php/publicknowledge/api/v1/submissions/${submissionId}`,
		failOnStatusCode: false,
	}).then(response => {
		expect(
			response.status,
			`Failed to reload submission ${submissionId}: ${JSON.stringify(response.body).slice(0, 1000)}`
		).to.eq(200);
		expect(response.body.currentPublicationId, 'current publication id').to.exist;

		return cy.request({
			url: `index.php/publicknowledge/api/v1/submissions/${submissionId}/publications/${response.body.currentPublicationId}`,
			failOnStatusCode: false,
		});
	}).then(response => {
		expect(
			response.status,
			`Failed to reload publication for submission ${submissionId}: ${JSON.stringify(response.body).slice(0, 1000)}`
		).to.eq(200);

		const publication = response.body;
		const localized = (value) => typeof value === 'string' ? value : value?.[expected.locale];

		expect(publication.locale, 'publication locale').to.eq(expected.locale);
		expect(localized(publication.title), 'persisted title').to.eq(expected.title);
		expect(localized(publication.abstract), 'persisted abstract').to.contain(expected.abstract);
		expect(
			publication.authorsString || publication.authorsStringShort,
			'persisted contributor'
		).to.contain('Submitter');
	});
}

describe('Quick Submit plugin tests', function() {
	it('Creates a published quick submission and persists all metadata', function() {
		const expected = {
			title: 'QuickSubmit Published Test Submission',
			abstract: 'This is a published QuickSubmit test submission.',
			locale: 'en',
		};

		cy.login('admin', 'admin', 'publicknowledge');

		cy.get('nav').contains('Tools').click();
		cy.get('a:contains("QuickSubmit Plugin")').click();
		cy.get('select[id="sectionId"]').select('Articles');
		cy.waitJQuery(); // Wait for form resubmission hack on section change.
		cy.wait(2000); // FIXME: Detached element delay

		// Capture the draft ID as a static value. Cypress query aliases are re-evaluated
		// when accessed; after save the form is replaced by the success page, so a
		// query alias would resolve against a DOM where this hidden input no longer exists.
		cy.get('input[name="submissionId"]')
			.invoke('val')
			.as('quickSubmitSubmissionId', {type: 'static'});
		cy.get('input[id^="title-en-"]').type(expected.title, {delay: 0});
		cy.get('textarea[id^="abstract-en-"]').then(node => {
			cy.setTinyMceContent(node.attr('id'), expected.abstract);
		});

		// Add an author. This is a separate AJAX write from the final metadata save.
		cy.get('a[id^="component-grid-users-author-authorgrid-addAuthor-button-"]').click();
		cy.wait(1000); // Form init delay
		cy.get('input[id^="givenName-en-"]').type('Quincy', {delay: 0});
		cy.get('input[id^="familyName-en-"]').type('Submitter', {delay: 0});
		cy.get('select[id="country"]').select('Canada');
		cy.get('input[id^=email-]').type('qsubmitter@mailinator.com', {delay: 0});
		cy.get('input[id^="affiliation-en-"]').type('Queens University', {delay: 0});
		cy.get('label:contains("Author")').click();
		cy.get('form[id="editAuthor"] button:contains("Save")').click();
		cy.get('div:contains("Author added.")');

		// Schedule for publication
		cy.get('input#articlePublished').click();
		cy.get('select#issueId').select('Vol. 1 No. 2 (2014)');
		cy.get('input[id^="datePublished-"]:visible').clear();
		cy.get('input[id^="datePublished-"]:visible').type('2020-01-01', {delay: 0});
		cy.get('input[id^="datePublished-"]:visible').blur(); // Take focus out of datepicker

		// Add a galley
		cy.get('a[id^="component-grid-articlegalleys-articlegalleygrid-addGalley-button-"]').click();
		cy.wait(1000); // Wait for the form to settle
		cy.get('input[id^=label-]').type('PDF', {delay: 0});
		cy.get('form#articleGalleyForm button:contains("Save")').click();
		cy.get('select[id=genreId]').select('Article Text');
		cy.wait(250);
		cy.fixture('dummy.pdf', 'base64').then(fileContent => {
			cy.get('div[id^="fileUploadWizard"] input[type=file]').attachFile(
				{fileContent, 'filePath': 'article.pdf', 'mimeType': 'application/pdf', 'encoding': 'base64'}
			);
		});
		cy.get('button').contains('Continue').click();
		cy.get('button').contains('Continue').click();
		cy.get('button').contains('Complete').click();

		// Complete the submission. Explicitly fail on gateway/backend errors such as 500/504/505.
		saveAndAssertRequestSucceeded();

		// A 2xx response is not enough: verify title/abstract/locale and author actually round-trip.
		cy.get('@quickSubmitSubmissionId').then(submissionId => {
			assertPublicationRoundTrip(submissionId, expected);
		});

		// Test the submission in the published front end.
		cy.get('.app__contextTitle:contains("Journal of Public Knowledge")').click();
		cy.get('a:contains("Archives")').click();
		cy.get('a:contains("Vol. 1 No. 2 (2014")').click();
		cy.get('a:contains("QuickSubmit Published Test Submission")').click();
		cy.get('section.abstract p:contains("This is a published QuickSubmit test submission.")');
		cy.get('ul.galleys_links a:contains("PDF")').click();
		cy.get('iframe');
	});

	it('Creates an unpublished quick submission without losing metadata', function() {
		const expected = {
			title: 'QuickSubmit Unpublished Test Submission',
			abstract: 'This is an unpublished QuickSubmit test submission.',
			locale: 'en',
		};

		cy.login('admin', 'admin', 'publicknowledge');

		cy.get('nav').contains('Tools').click();
		cy.get('a:contains("QuickSubmit Plugin")').click();
		cy.get('select[id="sectionId"]').select('Articles');
		cy.waitJQuery(); // Wait for form resubmission hack on section change.
		cy.wait(2000); // FIXME: Detached element delay

		// Capture the draft ID as a static value. Cypress query aliases are re-evaluated
		// when accessed; after save the form is replaced by the success page, so a
		// query alias would resolve against a DOM where this hidden input no longer exists.
		cy.get('input[name="submissionId"]')
			.invoke('val')
			.as('quickSubmitSubmissionId', {type: 'static'});
		cy.get('input[id^="title-en-"]').type(expected.title, {delay: 0});
		cy.get('textarea[id^="abstract-en-"]').then(node => {
			cy.setTinyMceContent(node.attr('id'), expected.abstract);
		});

		// Add an author. The production incident showed that this write can survive
		// even when the final publication-metadata save does not.
		cy.get('a[id^="component-grid-users-author-authorgrid-addAuthor-button-"]').click();
		cy.wait(1000); // Form init delay
		cy.get('input[id^="givenName-en-"]').type('Quincy', {delay: 0});
		cy.get('input[id^="familyName-en-"]').type('Submitter', {delay: 0});
		cy.get('select[id="country"]').select('Canada');
		cy.get('input[id^=email-]').type('qsubmitter@mailinator.com', {delay: 0});
		cy.get('input[id^="affiliation-en-"]').type('Queens University', {delay: 0});
		cy.get('label:contains("Author")').click();
		cy.get('form[id="editAuthor"] button:contains("Save")').click();
		cy.get('div:contains("Author added.")');

		saveAndAssertRequestSucceeded();

		// Regression for the KMANPUB partial-save symptom: author existence alone is not success.
		cy.get('@quickSubmitSubmissionId').then(submissionId => {
			assertPublicationRoundTrip(submissionId, expected);
		});

		cy.get('a:contains("Go to Submission")').click();
		cy.contains(expected.title);
		cy.get('button:contains("Schedule For Publication")');
	});
});
