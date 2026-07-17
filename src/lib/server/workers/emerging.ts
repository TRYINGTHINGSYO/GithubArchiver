import {
	CURRENT_EMERGING_DETECTION_VERSION,
	runEmergingTopicDetection
} from '../emerging-topics.js';
import { markEmergingAnalysisComplete } from '../discovery-materialized.js';
import { finishJobRun, startJobRun } from '../db/jobs.js';

const WINDOW_DAYS = Number(process.env.EMERGING_WINDOW_DAYS ?? 7);
const LIMIT = Number(process.env.EMERGING_LIMIT ?? 100);
const VERSION = Number(process.env.EMERGING_VERSION ?? CURRENT_EMERGING_DETECTION_VERSION);

export interface EmergingCycleResult {
	candidates: number;
	saved: number;
	periodStart: string;
	periodEnd: string;
	comparable: boolean;
}

export async function runEmergingTopicCycle(
	opts: {
		windowDays?: number;
		limit?: number;
		version?: number;
		periodEnd?: Date;
	} = {}
): Promise<EmergingCycleResult> {
	const jobId = startJobRun('pipeline', {
		phase: 'emerging',
		window_days: opts.windowDays ?? WINDOW_DAYS,
		limit: opts.limit ?? LIMIT
	});

	const result = runEmergingTopicDetection({
		periodEnd: opts.periodEnd,
		windowDays: opts.windowDays ?? WINDOW_DAYS,
		limit: opts.limit ?? LIMIT,
		version: opts.version ?? VERSION
	});

	const cycleResult: EmergingCycleResult = {
		candidates: result.candidates.length,
		saved: result.saved,
		periodStart: result.periodStart,
		periodEnd: result.periodEnd,
		comparable: result.comparability.comparable
	};

	markEmergingAnalysisComplete();
	finishJobRun(jobId, 'success', cycleResult);
	return cycleResult;
}
