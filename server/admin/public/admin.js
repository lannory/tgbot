// Progressive enhancement only: every form works without this file.
// - data-confirm="…"        asks before submitting
// - data-reason-prompt="…"  asks for an optional reason and puts it into the
//                           form's hidden `reason` field (cancel = no submit)
document.addEventListener('submit', (event) => {
	const form = event.target;
	if (!(form instanceof HTMLFormElement)) return;

	const confirmText = form.dataset.confirm;
	if (confirmText && !window.confirm(confirmText)) {
		event.preventDefault();
		return;
	}

	const promptText = form.dataset.reasonPrompt;
	if (promptText) {
		const reason = window.prompt(promptText, '');
		if (reason === null) {
			event.preventDefault();
			return;
		}
		const field = form.querySelector('input[name="reason"]');
		if (field) field.value = reason.slice(0, 500);
	}
});
