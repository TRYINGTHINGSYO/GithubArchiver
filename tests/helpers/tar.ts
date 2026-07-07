import { gzipSync } from 'node:zlib';

function tarChecksum(header: Buffer): void {
	let sum = 0;
	for (let i = 0; i < 512; i++) sum += header[i];
	header.write(sum.toString(8).padStart(6, '\0') + '\0 ', 148, 8);
}

export function createTarGz(rootName: string, fileName: string, content: string): Buffer {
	const path = `${rootName}/${fileName}`;
	const body = Buffer.from(content, 'utf8');
	const header = Buffer.alloc(512, 0);
	header.write(path, 0, 100, 'utf8');
	header.write(body.length.toString(8).padStart(11, '\0'), 124, 12);
	header.write('ustar\x00', 257, 6);
	header.write('00', 263, 2);
	tarChecksum(header);

	const padded = Buffer.alloc(Math.ceil(body.length / 512) * 512);
	body.copy(padded);
	const tar = Buffer.concat([header, padded, Buffer.alloc(512)]);
	return gzipSync(tar);
}
