import './load-env.js';
import { runDoctor } from '../src/lib/server/doctor.js';

const report = runDoctor({ repair: true });

for (const check of report.checks) {
	const tag = check.status.toUpperCase();
	console.log(`[${tag}] ${check.name}: ${check.message}`);
	if (check.samples?.length) {
		for (const sample of check.samples) {
			console.log(`       - ${sample}`);
		}
	}
}

if (report.repairs.length > 0) {
	console.log('');
	console.log('Repairs:');
	for (const repair of report.repairs) {
		const tag = repair.applied ? 'APPLIED' : 'SKIP';
		console.log(`[${tag}] ${repair.name}: ${repair.message}`);
	}
}

console.log('');
console.log(report.healthy ? 'Doctor: healthy' : 'Doctor: issues found');

if (!report.healthy) {
	process.exit(1);
}
