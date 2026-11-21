// Server-rendered SVG line chart (no client JS, works under a strict CSP).
// Input is numbers and YYYY-MM-DD strings from our own query only.

const W = 760;
const H = 220;
const PAD = { top: 16, right: 16, bottom: 28, left: 36 };

// Axis top with 4 equal integer steps (gridlines at 0, ¼, ½, ¾, 1)
function niceMax(value) {
	const raw = Math.max(1, value / 4);
	const pow = 10 ** Math.floor(Math.log10(raw));
	const step = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((s) => s * pow).find((s) => s >= raw && Number.isInteger(s)) ?? Math.ceil(raw);
	return step * 4;
}

export function renderDailyChart(series) {
	const n = series.length;
	if (n === 0) return '';

	const max = niceMax(Math.max(1, ...series.flatMap((d) => [d.new_users, d.active_users])));
	const iw = W - PAD.left - PAD.right;
	const ih = H - PAD.top - PAD.bottom;
	const x = (i) => PAD.left + (n === 1 ? iw / 2 : (i * iw) / (n - 1));
	const y = (v) => PAD.top + ih - (v / max) * ih;

	const line = (key) => series.map((d, i) => `${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join(' ');
	const dots = (key, cls) => series
		.map((d, i) => `<circle class="${cls}" cx="${x(i).toFixed(1)}" cy="${y(d[key]).toFixed(1)}" r="2.5"><title>${d.day}: ${d[key]}</title></circle>`)
		.join('');

	const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => {
		const v = Math.round(max * f);
		const gy = y(max * f).toFixed(1);
		return `<line class="grid" x1="${PAD.left}" x2="${W - PAD.right}" y1="${gy}" y2="${gy}"/>`
			+ `<text class="axis" x="${PAD.left - 6}" y="${gy}" text-anchor="end" dominant-baseline="middle">${v}</text>`;
	}).join('');

	const labelEvery = Math.ceil(n / 8);
	const labels = series.map((d, i) => (i % labelEvery === 0 || i === n - 1)
		? `<text class="axis" x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle">${d.day.slice(8, 10)}.${d.day.slice(5, 7)}</text>`
		: '').join('');

	return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Нові та активні користувачі по днях" preserveAspectRatio="xMidYMid meet">
${grid}${labels}
<polyline class="series-active" fill="none" points="${line('active_users')}"/>
<polyline class="series-new" fill="none" points="${line('new_users')}"/>
${dots('active_users', 'dot-active')}${dots('new_users', 'dot-new')}
</svg>`;
}
