import { describe, expect, it } from 'vitest';
import { evaluateTopicQuality, filterVerifiedTopics } from '$lib/server/topic-quality';

describe('topic-quality', () => {
	it.each(['jwt-authentication', 'google-gemini', 'streamlit', 'react-vite', 'tailwind-css', 'ollama'])(
		'accepts recognizable technical topic %s',
		(topic) => {
			const result = evaluateTopicQuality({ topic, count: 2 });
			expect(result.accepted).toBe(true);
			expect(result.score).toBeGreaterThanOrEqual(45);
		}
	);

	it.each(['assistant-for', 'assistant-that', 'management-built', 'built-using', 'with-python', 'that-analyzes', 'end-end'])(
		'rejects phrase fragment %s',
		(topic) => {
			const result = evaluateTopicQuality({ topic, count: 5 });
			expect(result.accepted).toBe(false);
			expect(result.reasons.length).toBeGreaterThan(0);
		}
	);

	it('returns only verified topics sorted by count and score', () => {
		const results = filterVerifiedTopics([
			{ topic: 'assistant-for', count: 20 },
			{ topic: 'ollama', count: 3 },
			{ topic: 'react-vite', count: 8 }
		]);

		expect(results.map((topic) => topic.label)).toEqual(['React Vite', 'Ollama']);
	});
});
