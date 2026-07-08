import type { WriteStream } from 'node:fs';
import { finished } from 'node:stream/promises';

export interface FinalizableArchive extends NodeJS.ReadableStream {
	finalize(): Promise<void> | void;
	destroy(error?: Error): this;
}

function toError(err: unknown): Error {
	return err instanceof Error ? err : new Error(String(err));
}

export function pipeArchiveToWriteStream(
	archive: FinalizableArchive,
	output: WriteStream
): () => Promise<void> {
	const archiveDone = finished(archive);
	const outputDone = finished(output);

	archive.on('error', (err) => output.destroy(toError(err)));
	output.on('error', (err) => archive.destroy(toError(err)));
	archive.pipe(output);

	return async () => {
		try {
			await archive.finalize();
			await Promise.all([archiveDone, outputDone]);
		} catch (err) {
			const error = toError(err);
			archive.destroy(error);
			output.destroy(error);
			throw error;
		}
	};
}
