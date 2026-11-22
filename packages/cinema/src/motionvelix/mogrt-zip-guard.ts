/**
 * MotionVelix MOGRT Engine: checks an archive before it is extracted.
 *
 * A `.mogrt` is a file from a third party. The check reads the declared names, types and sizes in
 * the ZIP's central directory; the extractor still applies its own path rules.
 */

const END_OF_DIRECTORY = 0x06054b50;
const DIRECTORY_ENTRY = 0x02014b50;
const MAX_ENTRIES = 20_000;
const MAX_EXPANDED_BYTES = 2 * 2 ** 30;
const SYMLINK = 0o120000;
const FILE_TYPE = 0o170000;

/** Throws when extracting `zip` could write outside its folder or fill the disk. */
export function assertSafeZip(zip: Buffer): void {
	const fail = (reason: string): never => {
		throw new Error(`ZIP recusado: ${reason}.`);
	};

	// The end record is followed only by a comment of at most 64 KiB.
	let end = -1;
	for (let o = zip.length - 22; o >= Math.max(0, zip.length - 22 - 0xffff); o--) {
		if (zip.readUInt32LE(o) === END_OF_DIRECTORY) {
			end = o;
			break;
		}
	}
	if (end < 0) return fail('arquivo inválido ou danificado');

	const count = zip.readUInt16LE(end + 10);
	if (count > MAX_ENTRIES) return fail('arquivos demais');
	let offset = zip.readUInt32LE(end + 16);
	let expanded = 0;
	for (let i = 0; i < count; i++) {
		if (offset + 46 > zip.length || zip.readUInt32LE(offset) !== DIRECTORY_ENTRY) return fail('diretório danificado');
		const nameLength = zip.readUInt16LE(offset + 28);
		const name = zip.toString('utf8', offset + 46, offset + 46 + nameLength).replace(/\\/g, '/');
		if (name.startsWith('/') || name.includes(':') || name.split('/').includes('..')) {
			return fail('contém um caminho fora da pasta de extração');
		}
		if (((zip.readUInt32LE(offset + 38) >>> 16) & FILE_TYPE) === SYMLINK) return fail('contém um link simbólico');
		// 0xffffffff marks ZIP64, which is past the limit anyway.
		expanded += zip.readUInt32LE(offset + 24);
		if (expanded > MAX_EXPANDED_BYTES) return fail('expande além de 2 GB');
		offset += 46 + nameLength + zip.readUInt16LE(offset + 30) + zip.readUInt16LE(offset + 32);
	}
}
